/*!
 * QHsafety risk engine — the local (no-AI) rules for risk detection and the language filter.
 *
 * ONE file, used in three places so they can never drift apart:
 *   • the browser  (index.html loads it before app.js)
 *   • the server   (api/analyze.js requires it for the safety floors)
 *   • the tests    (node tests/risk.test.js)
 *
 * Design rule: prefer a false alarm over a missed crisis, but do not raise alarms on
 * everyday talk ("hang out", "kill this exam", "patay ako sa nanay ko").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QHRisk = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEVELS = ['Low', 'Low-Medium', 'Medium', 'High'];
  function levelRank(l) { var i = LEVELS.indexOf(String(l || '').trim()); return i < 0 ? 0 : i; }
  function maxLevel(a, b) { return levelRank(a) >= levelRank(b) ? (a || 'Low') : (b || 'Low'); }

  var THREAT_REASON   = 'Threat of violence against others (A4)';
  var POSSIBLE_THREAT = 'Violent language (may be gaming or sports talk — please review)';

  // ───────────────────────────── 1. NORMALISING ─────────────────────────────
  // Students type on phones: curly quotes, no apostrophes, text-speak, leet, stretched letters.
  var LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
  var WORD_FIX = [
    [/\b(dont|don t)\b/g, "don't"], [/\b(cant|can t)\b/g, "can't"], [/\bwont\b/g, "won't"],
    [/\bdidnt\b/g, "didn't"], [/\bdoesnt\b/g, "doesn't"], [/\bhavent\b/g, "haven't"], [/\bhasnt\b/g, "hasn't"],
    [/\bcouldnt\b/g, "couldn't"], [/\bwouldnt\b/g, "wouldn't"], [/\bshouldnt\b/g, "shouldn't"],
    [/\bisnt\b/g, "isn't"], [/\barent\b/g, "aren't"], [/\bwasnt\b/g, "wasn't"],
    [/\b(i'm|im|i m)\b/g, 'i am'], [/\b(i've|ive)\b/g, 'i have'], [/\bi'll\b/g, 'i will'],
    [/\bwe'll\b/g, 'we will'], [/\bwe're\b/g, 'we are'], [/\bthey'll\b/g, 'they will'], [/\bthey're\b/g, 'they are'],
    [/\byou're\b/g, 'you are'], [/\byou'll\b/g, 'you will'], [/\bhe'll\b/g, 'he will'], [/\bshe'll\b/g, 'she will'],
    [/\bwhat's\b/g, 'what is'],
    [/\bwanna\b/g, 'want to'], [/\b(gonna|gunna|finna)\b/g, 'going to'], [/\bgotta\b/g, 'have to'], [/\btryna\b/g, 'trying to'],
    [/\bu\b/g, 'you'], [/\bur\b/g, 'your'], [/\burself\b/g, 'yourself'], [/\bmyslf\b/g, 'myself'],
    [/\bkms\b/g, 'kill myself'], [/\bkys\b/g, 'kill yourself'],
    [/\bunaliv(e|ing|ed)\b/g, function (m, s) { return s === 'e' ? 'kill' : s === 'ing' ? 'killing' : 'killed'; }],
    [/\b(sewer ?slide|suicde|sucide|suiside|suicied|sucid)\b/g, 'suicide'],
    // Filipino text-speak
    [/\b(aq|aku|akoh)\b/g, 'ako'], [/\b(q|koh)\b/g, 'ko'], [/\bqng\b/g, 'kong'],
    [/\bayoko(ng)?\b/g, function (m, ng) { return 'ayaw ko' + (ng ? 'ng' : ''); }], [/\bayoq\b/g, 'ayaw ko'],
    [/\b(nalang|nlng|na lng|nlang)\b/g, 'na lang'], [/\blng\b/g, 'lang'],
    [/\bsna\b/g, 'sana'], [/\b(gsto|gs2|gusto2)\b/g, 'gusto'], [/\btlga\b/g, 'talaga'],
    [/\b(kc|ksi|kse)\b/g, 'kasi'], [/\bnmn\b/g, 'naman'], [/\b(sakin|saken|skn)\b/g, 'sa akin'],
    [/\bwla\b/g, 'wala'], [/\bwlang\b/g, 'walang'], [/\bwala ng\b/g, 'wala nang'],
    [/\b(di|hnd|hndi|hinde|hindi)\b/g, 'hindi'], [/\bpra\b/g, 'para'], [/\bmmtay\b/g, 'mamatay'],
  ];

  function baseNormalise(text) {
    var t = String(text == null ? '' : text).toLowerCase()
      .replace(/[‘’‛′`´]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ').trim();
    // leet inside a word (k1ll, d1e, m4m4t4y) — but leave "grade10", "form137", "2nd" alone
    t = t.replace(/[a-z0-9@$]+/g, function (tok) {
      if (!/[a-z]/.test(tok) || !/[0-9@$]/.test(tok)) return tok;
      if (/^[a-z]+\d+$/.test(tok) || /^\d+[a-z]{1,2}$/.test(tok)) return tok;
      return tok.replace(/[013457@$]/g, function (c) { return LEET[c]; });
    });
    return t;
  }
  function applyWordFixes(t) {
    for (var i = 0; i < WORD_FIX.length; i++) t = t.replace(WORD_FIX[i][0], WORD_FIX[i][1]);
    return t.replace(/\s+/g, ' ').trim();
  }

  // Figures of speech that only LOOK dangerous. They are blanked out before scoring.
  var IDIOMS = [
    /\bkill(?:ed|ing|s)? (?:it|time|the (?:vibe|mood|lights?|engine|game|beat)|(?:this|that|the|my|our) (?:exam|test|quiz|presentation|performance|interview|audition|recital|report|workout))\b/g,
    /\b(?:could|would|can|will|'d) kill for\b/g,
    /\b(?:could|would|can|will) (?:literally |totally |so |really )?(?:kill|murder) (?:a|an|some) (?!person|man|woman|kid|guy|girl|boy|teacher|student|classmate|bully|child|baby)\w+/g,
    /\bpapatayin (?:talaga |na naman )?ako ng (?:nanay|mama|mommy|mom|tatay|papa|daddy|dad|magulang|parents|ate|kuya|lola|lolo|teacher|adviser)(?: ko)? (?:pag|kapag|kung|kasi|dahil|nito|dito|talaga)\b/g, /\bkill(?:ing)? (?:them|him|her|you|'em) with kindness\b/g,
    /\b(?:is|are|was|were|keeps?|been) killing me\b/g, /\bkiller (?:outfit|look|smile|moves?|song|abs|whale|instinct)\b/g,
    /\bdressed to kill\b/g, /\bif looks could kill\b/g, /\b(?:mom|mother|mama|nanay|dad|father|papa|tatay|parents?|teacher|adviser|ate|kuya) (?:is|are|will|would|is going to|are going to) (?:going to )?kill me\b/g,
    /\bdying (?:of|from|with) (?:laughter|laughing|embarrassment|boredom|hunger|thirst|heat|cringe|cuteness|kilig|curiosity|excitement)\b/g,
    /\bdie(?:d|s)? (?:laughing|of laughter|of embarrassment|of boredom|of cringe|of kilig)\b/g,
    /\bdying to\b/g, /\bto die for\b/g, /\bdo or die\b/g, /\bdie-?hard\b/g,
    /\bi am (?:so |literally )?dead(?= ?(?:lol|lmao|lmfao|haha|hehe|xd|😂|💀|😭|🤣))/g,
    /\bdead ?(?:line|lines|lock|end|tired|serious|weight|air|pan|beat|battery|phone|zone|center|centre)\b/g, /\bdrop dead gorgeous\b/g,
    /\b(?:phone|cp|cellphone|battery|batt|laptop|wifi|wi-fi|signal|line|pc|computer|tablet|charger|data) (?:is |was |just )?(?:dead|dying|died)\b/g,
    /\bpatay (?:na )?(?:ang |yung |ung )?(?:ilaw|cp|phone|cellphone|wifi|battery|batt|signal|kuryente|tv|aircon|electric fan|laptop|data)\b/g,
    /\b(?:namatay|patay) (?:na )?(?:ang |yung |ung )(?:ilaw|cp|phone|cellphone|wifi|battery|batt|signal|kuryente|tv|aircon|laptop)\b/g,
    /\bpatay (?:na naman )?(?:ako|tayo|kami|ka|kayo|sila)(?: na)? (?:sa|kay|dyan|diyan|dito|nito|niyan|nyan|pag|kapag|kung|talaga|nanaman|na naman)\b/g,
    /\bpatay (?:na )?patay\b/g, /\bpatay[- ](?:gutom|malisya|sindi)\b/g, /\blagot (?:ako|tayo|ka|kayo)\b/g,
    /\bsasabog (?:na )?(?:ang |yung |ung )?(?:ulo|utak|dibdib|puso|pantog|tiyan|tyan|bituka)(?: ko)?\b/g,
    /\bshoot(?:ing|s)? (?:a|an|the|some|my|our|this|that) (?:\w+ )?(?:video|film|photo|picture|pic|movie|scene|vlog|shot|hoops?|ball|basket|three|free throw|documentary|commercial|ad|content|reel|tiktok)\b/g,
    /\b(?:photo|video|film|pictorial) ?shoot(?:ing)?\b/g, /\bshooting (?:practice|guard|star|range|drills?|schedule|day|location)\b/g,
    /\bshoot (?:me|you|him|her|them|us) (?:a|an|the|some) (?:text|message|email|dm|msg|chat|call|link|copy|invite)\b/g,
    /\bhit (?:the|a|an|my|some) (?:\w+ )?(?:gym|books?|road|sack|hay|shower|ball|notes?|note|like|target|button|bed|mall|beach|court|jackpot|spot|brakes?|lights?|sheets?|deadline|goal|quota|bullseye)\b/g,
    /\bhit (?:me|you|him|her|them|us) up\b/g, /\bhit (?:it off|or miss|the nail)\b/g,
    /\bhang(?:ing|s)? (?:out|on|up|in there|around|back)\b/g,
    /\bhang(?:ing)? (?:the|my|our|some|up the|these|those) (?:\w+ )?(?:clothes|posters?|decor\w*|banners?|laundry|pictures?|frames?|lights?|curtains?|uniform|tarpaulins?|tarps?|streamers?|medals?|jacket|bag)\b/g,
    /\bbl(?:ow|ew)(?:ing|s)? (?:up|out) (?:the |my |a |some |our )?(?:balloons?|candles?|phone|notifications?|gc|group chat|inbox|feed)\b/g,
    /\bbomb(?:ed|ing)? (?:the|my|a|an|that|this|our) (?:\w+ )?(?:test|exam|quiz|interview|audition|presentation|recitation|oral|report)\b/g,
    /\bphoto ?bomb\w*\b/g, /\b(?:da|the) bomb\b/g, /\bbath bomb\w*\b/g,
    /\bbeat(?:ing|s)? (?:the|my|our|a|your|his|her|their) (?:\w+ )?(?:record|score|team|game|level|boss|deadline|heat|traffic|rush|time|odds|system|clock|high score|curfew)\b/g,
    /\bmurder(?:ed|ing)? (?:the|that|this|my) (?:exam|test|quiz|performance|song|presentation|beat|dance)\b/g,
    /\bslay(?:ed|ing|s)?\b/g, /\bcrush(?:ed|ing)? (?:it|the (?:exam|test|quiz))\b/g,
    /\bstab(?:bing)? (?:pain|feeling)\b/g, /\bstabbed in the back\b/g, /\bbackstab\w*\b/g,
  ];
  function stripIdioms(t) {
    for (var i = 0; i < IDIOMS.length; i++) t = t.replace(IDIOMS[i], ' _ ');
    return t.replace(/\s+/g, ' ').trim();
  }
  function prepare(text) { return stripIdioms(applyWordFixes(baseNormalise(text))); }

  // ─────────────────────── 2. THREATS AGAINST OTHER PEOPLE ───────────────────────
  var GAME_CONTEXT = /\b(ml|mlbb|mobile legends?|codm?|call of duty|valorant|valo|dota ?2?|roblox|minecraft|fortnite|pubg|free ?fire|genshin|wild ?rift|tekken|games?|gaming|laro|maglalaro|naglalaro|rank(?:ed)?|match|rounds?|tournament|tourney|finals?|semis|championship|intrams|intramurals|liga|basketball|volleyball|football|soccer|badminton|chess|sepak|quiz bee|debate|sparring|boxing|taekwondo|karate|arnis|pvp|1v1|scrim|lobby|boss fight|e-?sports?|team|kalaban sa)\b/;
  var COOKING_CONTEXT = /\b(cooking|cookery|cook|tle|home ?ec\w*|kitchen|kusina|baking|food tech\w*|culinary|luto|magluluto|carving|art project|scouting|camping)\b/;

  var FILLER = "(?:(?:am|are|really|just|seriously|honestly|literally|actually|so|still|kinda|sometimes|always|truly|swear|fucking|freaking) )*";
  var INTENT = "\\b(?:i|we) " + FILLER + "(?:will|shall|going to|want to|wanted to|plan to|planning to|should|might|could|can|have to|need to|about to|would love to|would|feel like|am ready to|ready to)(?: (?:really|just|literally|definitely|seriously|fucking|actually|also))? ";
  var STRONG = "(?:kill|murder|stab|massacre|slaughter|strangle|rape|behead|gun down|shoot up|shoot dead|slit)";
  var STRONG_BENIGN = "(?! (?:myself|my self|my own life|me\\b|it\\b|_|time\\b|for\\b|off\\b|(?:the|this|that|a|an|some|those|these|all the) (?:\\w+ )?(?:exam|test|quiz|game|boss|vibe|mood|lights?|engine|bugs?|mosquito\\w*|cockroach\\w*|ipis|lamok|rats?|ants?|fl(?:y|ies)|zombies?|monsters?|enem(?:y|ies)|creepers?|bots?|mobs?|weeds?|germs?|bacteria|virus\\w*|plants?|presentation|performance|interview|competition)\\b))";
  var PERSON = "(?:you(?: all| guys)?|ya|him|her|them(?: all)?|someone|somebody|some ?one|anyone|anybody|everyone|everybody|every ?one|people|all of (?:you|them)|(?:(?:my|our|the|that|this|those|these|a|an|some|his|her|their|your) )?(?:(?:[a-z]+) ){0,2}?(?:teachers?|adviser|principal|classmates?|schoolmates?|seatmates?|batchmates?|students?|kids?|guys?|girls?|boys?|bully|bullies|friends?|ex|boyfriend|girlfriend|bf|gf|brother|sister|mom|mother|dad|father|stepdad|stepfather|stepmom|stepmother|parents?|family|cousins?|uncle|aunt|neighbou?rs?|sir|ma'?am|coach|guard|bitch|bastard|idiot|person)|the (?:whole |entire )?(?:school|class|campus|section|room))";
  var WEAK = "(?:hurt|harm|shoot|bomb|blow up|burn|beat up|beat|poison|wipe out|eliminate|execute|destroy|hang|choke|hit|punch|attack|jump|stomp|slap|kick|smash|cut|torture|drown)";
  // "beat him up" is violent; "hit him up" is an idiom and was already blanked in stripIdioms.
  var WEAK_TAIL = "(?! (?:a|an|the|some|my|your) (?:message|text|email|dm|msg|call|ride|hug|favor|copy|link|invite|chat|pic|photo)\\b)";

  var EN_STRONG   = new RegExp(INTENT + STRONG + "\\b" + STRONG_BENIGN);
  var EN_WEAK     = new RegExp(INTENT + WEAK + " (?:up |down |out )?" + PERSON + "\\b" + WEAK_TAIL);
  var EN_PLACE    = /\b(?:shoot(?:ing)? up|bomb(?:ing)?|blow(?:ing)? (?:up|out)|burn(?:ing)? down|attack(?:ing)?|set(?:ting)? fire to|torch(?:ing)?|shoot(?:ing)? (?:at|in)) (?:the |this |our |my |that )?(?:whole |entire )?(?:school|campus|classroom|class|canteen|gym|building|library|faculty|office)\b/;
  var EN_MASS     = /\bschool shoot(?:ing|er)\b|\bmass (?:shooting|murder|killing|stabbing)\b|\bmake (?:them|everyone|everybody|him|her|you|you all) (?:all )?(?:pay|suffer|die|bleed|regret)\b|\bthey (?:will|are going to|are gonna) (?:all )?(?:die|pay|bleed|regret (?:it|this))\b|\b(?:kill|murder|shoot|stab|slaughter) (?:them all|you all|everyone|everybody|every ?one|all of (?:you|them)|all (?:my|the) (?:classmates|teachers|students))\b|\byou (?:are|will)(?: all)? (?:going to )?(?:die|be dead|dead)\b|\b(?:he|she|they|you) (?:deserves?|should|must|needs? to) (?:to )?die\b/;
  var EN_WEAPON   = /\b(?:i|we)\b[^.!?]{0,30}?\b(?:bring|brought|bringing|have|got|carry|carrying|hid|hide|hiding|take|taking|took|sneak\w*|pack(?:ed|ing)?) (?:a |an |my |the |(?:my )?(?:dad|father|uncle|brother|kuya|tito|papa|tatay)'?s )?(?:gun|knife|bomb|pistol|revolver|weapon|firearm|explosives?|balisong|patalim|baril|kutsilyo|ice ?pick|blade|machete|bolo|itak)\b[^.!?]{0,60}?\b(?:school|campus|class|classroom|students?|everyone|them|him|her|tomorrow|bukas|bag|locker)\b/;
  var EN_USE_IT   = /\b(?:use|point|pull|aim|fire) (?:it|that|this|the (?:gun|knife|weapon)) (?:on|at) (?:him|her|them|you|everyone|someone|my \w+|the \w+)\b/;

  var TL_VERB = "(?:papatayin|patayin|sasaksakin|saksakin|babarilin|barilin|bubugbugin|bugbugin|sasaktan|saktan|gugulpihin|gulpihin|susunugin|sunugin|pasasabugin|papasabugin|pasabugin|bobombahin|lalasunin|lasunin|sasapakin|sapakin|susuntukin|suntukin|uupakan|upakan|bibirahin|tatagain|tagain|gigilitan|gilitan|sasakalin|sakalin|hahampasin|tutuluyan|ipapapatay|ipapatay|pagpapatayin|pagsasaksakin|gagahasain|rereypin|hahalayin)";
  var TL_PART = "(?: (?:na|nga|talaga|rin|din|lang|sana|pa|naman))*";
  var TL_FIRST    = new RegExp("\\b" + TL_VERB + TL_PART + " (?:ko|kita|namin|natin)\\b(?!" + TL_PART + " (?:ang |yung |ung )?(?:aking )?sarili)");
  var TL_WANT     = new RegExp("\\bgusto (?:ko|kong|namin|naming)(?: (?:na|nang|talaga|talagang|lang|sana|siya|siyang|sila|silang|kayo|kayong|ka|kang|kita|kitang))* (?:(?:na|nang) )?(?:" + TL_VERB + "|pumatay|manakit|manaksak|mamaril|manunog|magpasabog|gumanti|maghiganti|manggulpi|mambugbog)\\b(?! (?:ang |yung |ung )?(?:aking )?sarili)");
  var TL_ACTOR    = /\b(?:papatay|mamamaril|mananaksak|magpapasabog|manununog|mamamatay[- ]tao|mambubugbog|maghihiganti|gaganti) (?:na |talaga |rin |din )*(?:ako|kami|tayo)\b(?! (?:ng |sa )?(?:aking )?sarili)/;
  var TL_WEAPON   = /\b(?:magdadala|magdala|nagdala|nagdadala|may dala|dadalhin|dala|magbabaon|may baon|may)(?: ako| ko| akong| kami)?(?: ng| na| ang)? (?:baril|kutsilyo|patalim|balisong|bomba|ice ?pick|armas|granada|itak|bolo)\b[^.!?]{0,50}?\b(?:school|eskwela\w*|eskuwela\w*|paaralan|klase|classroom|room|bukas|campus|bag)\b/;
  var TL_PLACE    = /\b(?:pasasabugin|papasabugin|susunugin|bobombahin|sasalakayin)(?: (?:ko|namin|natin|na|talaga))* (?:ang |yung |ung )?(?:school|paaralan|eskwela\w*|eskuwela\w*|classroom|campus|building|room|faculty)\b/;
  var TL_MASS     = /\bmamamatay (?:na )?(?:kayo|sila)(?:ng lahat| lahat)?\b|\bpapatayin (?:ko )?(?:kayong|silang) lahat\b|\buubusin ko (?:kayo|sila)\b/;
  var TL_SOFT     = /\bhumanda (?:ka|kayo|sila|siya)\b|\bmay araw (?:ka|kayo|sila|siya) (?:rin |din )?sa akin\b|\bmagbabayad (?:ka|kayo|sila|siya)\b|\babangan (?:kita|ko (?:siya|sila|kayo))\b|\btatambangan (?:kita|ko)\b/;

  // returns 'certain', 'possible' or null — expects text already passed through prepare()
  function threatLevel(p) {
    var strong = EN_STRONG.test(p) || EN_MASS.test(p) || TL_FIRST.test(p) || TL_WANT.test(p) || TL_ACTOR.test(p) || TL_MASS.test(p);
    var place  = EN_PLACE.test(p) || TL_PLACE.test(p);
    var weapon = EN_WEAPON.test(p) || TL_WEAPON.test(p) || EN_USE_IT.test(p);
    var weak   = EN_WEAK.test(p);
    var soft   = TL_SOFT.test(p);
    var game   = GAME_CONTEXT.test(p);
    if (place) return 'certain';                                   // an attack on the school is never "just a game"
    if (weapon) return COOKING_CONTEXT.test(p) && !strong && !weak ? 'possible' : 'certain';
    if (strong) return game ? 'possible' : 'certain';
    if (weak)   return game ? null : 'certain';
    if (soft)   return 'possible';
    return null;
  }
  function detectThreatToOthers(text) { return threatLevel(prepare(text)) === 'certain'; }

  // ───────────────────────────── 3. PATTERN LIBRARY ─────────────────────────────
  // Direct, unambiguous wish or plan to die — one hit is enough for High.
  var criticalPatterns = [
    /\b(?:want(?:ed)?|wanting|going|need|plan(?:ning)?|about|trying|tried|ready|decided|deserve) to (?:just )?(?:kill myself|die\b|end my (?:own )?life|end it all|take my (?:own )?life|commit suicide|hang myself|shoot myself|drown myself|stab myself|jump off|overdose|disappear forever|not exist|stop existing|be dead)/,
    /\bkill(?:ing|ed)? (?:myself|my self)\b/,
    /\bi (?:do not|don't|no longer|never) (?:want|wish|wanted) to (?:live|be alive|exist|wake up|go on living|keep living)\b/,
    /\bi (?:do not|don't|no longer) (?:want|wish) to be (?:here|around)(?: in this world)? (?:anymore|any more|any longer)\b/,
    /\b(?:i )?wish i (?:was|were|am) (?:dead|never born|not alive|not born|gone forever)\b|\bwish i (?:could )?(?:just )?(?:die|disappear forever|not wake up)\b|\bwish i (?:had )?never (?:been born|existed)\b/,
    /\bbetter off (?:dead|without me|if i (?:was|were|am) (?:gone|dead|not (?:here|around)))\b|\b(?:world|everyone|everybody|they|family) (?:would|will|is|are) (?:be )?better (?:off )?without me\b/,
    /\b(?:sleep|go to sleep|fall asleep) (?:forever|and never wake up|and not wake up)\b|\bnever wake up(?: again)?\b|\bnot wake up (?:tomorrow|anymore|again)\b/,
    /\b(?:thinking|think|thought|thoughts) (?:a lot )?(?:of|about) (?:suicide|killing myself|ending (?:it all|it\b(?! with)|my life|everything)|dying|taking my (?:own )?life)\b/,
    /\b(?:feel(?:ing)?|am|been) suicidal\b|\bsuicidal (?:thoughts|ideation|feelings)\b|\battempt(?:ed|ing)? suicide\b|\bsuicide (?:attempt|note|plan)\b/,
    /\bend(?:ing)? (?:it all|my (?:own )?life)\b|\btake my (?:own )?life\b/,
    /\b(?:this is|it is|it's) (?:my |the )?(?:last|final) (?:message|post|goodbye|good bye|day|night|time you will hear)\b|\bgoodbye (?:everyone|everybody|world|forever)\b|\bsay(?:ing)? goodbye to (?:everyone|everybody|you all)\b|\bmy (?:last|final) (?:message|goodbye|words)\b/,
    /\b(?:pills?|tablets?|meds|medicines?|medication)\b[^.!?]{0,50}\btake (?:all|them all|too many|the whole)\b|\btake (?:all|too many|a whole bottle)\b[^.!?]{0,25}\b(?:pills?|tablets?|meds|medicines?)\b|\boverdos(?:e|ed|ing) (?:on|myself|tonight|later)\b/,
    /\bno (?:reason|point) (?:to live|in living|to go on|to stay alive|to be alive|to keep living)\b|\bwhat is the point (?:of|in) (?:living|life|being alive|going on|staying alive)\b|\bnothing (?:left )?to live for\b/,
    /\bi (?:do not|don't) deserve to (?:live|be alive|exist|be here)\b/,
    /\b(?:life|living) (?:is|isn't|is not|ain't|feels) (?:not |no longer )?worth (?:living|it|the pain)\b|\bnot worth living\b/,
    /\bi am (?:ending|going to end) it\b(?! with| between)|\bi (?:just )?want (?:it|everything|this|the pain) (?:all )?to (?:end|stop|be over)\b/,
    // Filipino
    /\b(?:pagod|sawa|suko|ayaw|tamad)(?: (?:na|nang|talaga))* (?:ako|akong|ko|kong)(?: (?:na|nang))* (?:mabuhay|sa buhay(?: ko| na ito)?)\b/,
    /\bwala na (?:akong|ako(?:ng)?) (?:ganang|gana|dahilang|dahilan|lakas|rason)(?: (?:para|na|pang|pa))* (?:mabuhay|magpatuloy(?: sa buhay)?)\b/,
    /\bhindi ko na (?:kaya|kayang|gusto|gustong)(?: pang)? (?:mabuhay|magpatuloy sa buhay)\b/,
    /\bgusto (?:ko|kong)(?: (?:na|nang|talaga|talagang|lang|sana))* ?(?:na |nang )?(?:mamatay|magpakamatay|magpatiwakal|maglaho(?: na)?(?: sa mundo)?|mawala (?:na )?(?:sa mundo|sa mundong ito|ng tuluyan|nang tuluyan|habang buhay)|tapusin (?:na )?(?:ang |yung |ung )?(?:lahat|buhay ko|aking buhay|buhay)|wakasan (?:na )?(?:ang |yung )?(?:buhay ko|lahat))\b/,
    /\b(?:magpapakamatay|papakamatay|magpakamatay|magpapatiwakal|papatiwakal|magbibigti|bibigti|magbibitay|maglalaslas|magpapasagasa|magpapalunod|magpapakalunod|maglalason)(?: (?:na|lang|na lang|talaga|nga))* (?:ako|na ako)\b/,
    /\b(?:swallowed|took|taken|drank|ingested|uminom|ininom|nilunok|lumunok)\b[^.!?]{0,25}?\b(?:a (?:bunch|lot|whole bottle|handful) of|too many|maraming|madaming|lahat ng|sobrang daming) (?:pills|tablets|meds|medicines?|gamot|tableta|sleeping pills)\b|\b(?:drank|uminom ako ng|ininom ko ang) (?:bleach|zonrox|muriatic|lason|poison|silver cleaner)\b/,
    /\btatalon (?:na )?(?:ako|na ako) (?:sa|mula sa) (?:building|tulay|bubong|rooftop|bintana|overpass|footbridge|mrt|lrt|riles|bangin|\d+(?:st|nd|rd|th)? floor|taas)\b/,
    /\biinom (?:na )?(?:ako |na ako )?ng (?:maraming|madaming|lahat ng|sobrang daming|napakaraming) (?:gamot|tableta|pills|biogesic|paracetamol|sleeping pills)\b|\biinom (?:na )?ako ng (?:lason|zonrox|muriatic|baygon|clorox|silver cleaner)\b|\blalaklak(?:in)? (?:ako |ko )?(?:ng |ang )?(?:lason|zonrox|muriatic|gamot|silver cleaner)\b/,
    /\bayaw ko (?:na|nang)(?:ng)? ?(?:mabuhay|ng buhay|sa buhay(?: ko| na ito)?|magising|gumising|mag-?exist)\b/,
    /\bsana (?:mamatay|patay|mawala|wala) (?:na )?(?:lang )?(?:na )?ako\b|\bsana (?:hindi|wag) na (?:lang )?ako (?:magising|gumising|nabuhay|ipinanganak|pinanganak|isinilang)\b|\bsana (?:hindi) na lang ako (?:nabuhay|pinanganak|ipinanganak)\b|\bsana (?:kunin|kinuha) na (?:lang )?ako ni lord\b/,
    /\b(?:mas )?(?:mabuti|maigi|mainam|okay|ok|maganda)(?: pa| pang| nang| na)*(?: kung)? (?:patay|mamatay|mawala|wala)(?: na)?(?: lang)? ako\b/,
    /\bpapatayin ko (?:na )?(?:lang )?(?:ang |yung )?(?:aking )?sarili(?: ko)?\b|\bkikitilin ko (?:na )?(?:ang )?(?:sarili|buhay)|\btatapusin ko (?:na )?(?:ang |yung |ung )?(?:buhay ko|aking buhay|lahat)\b|\btapusin (?:na )?(?:ang |yung |ung )?(?:buhay ko|aking buhay)\b|\bwawakasan ko (?:na )?(?:ang |yung )?(?:buhay ko|lahat)\b/,
    /\bhuling (?:mensahe|post|paalam|araw|gabi) ko (?:na )?(?:ito|to)\b|\bpaalam (?:na )?(?:sa inyong lahat|sa lahat|mundo)\b/,
  ];

  var highRiskPatterns = [
    // English — suicidal
    /\bi want to (?:just )?(?:hurt myself|kill myself|die\b|end it\b(?! with| between| there| here)|commit suicide)/,
    /\bi (will|going to) (kill myself|hurt myself|die|end it all|take my life)/,
    /\bi feel like (hurting|killing) myself/,
    /\b(kill|killing|hurt|hurting|harm|harming) (myself|my self)\b/,
    /\bi am (going to) (kill|hurt|end) (myself|it all)\b/,
    /\bi (might|should|could) (hurt|kill) myself/,
    /\bi (?:can't|cannot) (?:take|handle|do|bear|stand) (?:(?:this|it|life|everything|all of this|any of this) )?(?:anymore|any more|no more|any longer)\b/,
    /\bi want to (disappear|not exist|be gone|cease to exist)/,
    /\bbetter off (dead|without me|gone)/,
    /\bno (point|reason|purpose) in (living|life|continuing)/,
    /\bi am done (with life|living|with everything)/,
    /\bplease (just let me die|kill me|end my life)/,
    /\bi wish i (was|were|am) dead/,
    /\bi don't want to (be here|exist|live|wake up) anymore/,
    /\bend (it all|my life|my suffering|my pain|everything)/,
    /\bjust (?:kill me|let me die|end it\b(?! with| between| there| here)|make it stop)/,
    /\bi have been (thinking about|considering|planning) (suicide|killing myself|ending my life)/,
    /\bwhat is the point (of|in) (living|going on|continuing)/,
    /\bi (can't|cannot) keep (going|living|doing this)/,
    /\btired of (being alive|living|everything|waking up)/,
    /\bno (one|reason) to (live|go on|stay)/,
    /\bmaybe (i should|it would be better if i) (just die|not wake up|disappear)/,
    /\bi don't (deserve|want) to (be alive|live|exist)/,
    /\bcutting (myself|my wrists|my arms|my skin)/,
    /\bi (have been|been) (cutting|burning|hurting|harming) (myself|my body)/,
    /\bmarks (on|all over) (my arms|my wrists|my body|my legs)/,
    /\bself(-)?(harm|harming|injury|injuring)/,
    // Tagalog — direct suicidal / wanting to die
    /\bmagp(a)?pakamatay (?:(?:na|nang|na lang|lang) )?ako/,
    /\bmagpapatiwakal (?:(?:na|nang|na lang|lang) )?ako/,
    /\bpapatayin ko (?:(?:na|nang|na lang|lang) )?(?:(?:ang) )?sarili ko/,
    /\bpatayin (nyo|mo|na lang|ninyo|kayo) (?:(?:na|nang|na lang|lang) )?ako/,
    /\bgusto ko(ng)? (?:(?:na|nang|na lang|lang) )?(mamatay|magpakamatay|patayin ang sarili)/,
    /\bmamatay (?:(?:na|nang|na lang|lang) )?ako (sana|na lang|na)/,
    /\bsana (mamatay|patay|wala) na (ako|lang ako)/,
    /\bayaw ko na(ng)? (mabuhay|ng buhay|umiral)/,
    /\bmas (mabuti|mainam|maganda|mabuti pa) (?:(?:kung) )?(patay|wala na|hindi na umiral) (?:(?:na|nang|na lang|lang) )?ako/,
    /\bwala nang (saysay|kwenta|dahilan) (?:(?:para) )?(mabuhay|sa buhay ko)/,
    /\btapos na ako sa buhay\b/,
    /\bsawa na ako sa (buhay|lahat|mundo)/,
    /\bhindi ko na (kaya|kayang tiisin|kayang harapin) (?:(?:ang) )?(buhay|lahat|ito)/,
    /\btulungan (nyo|mo|ninyo) (?:(?:na|nang|na lang|lang) )?akong (mamatay|magpakamatay)/,
    /\bgusto ko(ng)? (masaktan|patayin) (?:(?:ang) )?sarili ko/,
    /\b(sasaktan|papatayin|susugatan) ko (?:(?:ang) )?sarili ko/,
    /\bpakiramdam ko(ng)? gusto ko(ng)? (mamatay|masaktan ang sarili|mawala)/,
    /\bwala na(ng)? dahilan para (mabuhay|magpatuloy)/,
    /\bito na (?:(?:ang) )?(huli|katapusan|wakas) (ko|ng buhay ko)/,
    // Tagalog — asking others to harm them
    /\bpatayin (?:(?:na|nang|na lang|lang) )?(nyo|mo|ninyo) (?:(?:na|nang|na lang|lang) )?ako/,
    /\bsaktan (?:(?:na|nang|na lang|lang) )?(nyo|mo|ninyo) (?:(?:na|nang|na lang|lang) )?ako/,
    /\btulungan (nyo|mo) akong (mamatay|mawala)/,
  ];
  var planPatterns = [
    // English
    /\bhow to (kill myself|hurt myself|commit suicide|overdose)/,
    /\b(?:pills?|knife|rope|jump|cut|bleed|overdose|poison|gun|hang)\b.{0,60}?\b(?:myself|suicide|die)\b/,
    /\bi have (?:a plan|the means|a way|everything ready) to (?:die|kill myself|end (?:it|my life|everything)|do it)\b/,
    /\bi have been (cutting|hurting|harming) myself/,
    /\btaking (too many|a lot of|all my) (pills|tablets|meds)/,
    // Tagalog — method or means
    /\bpaano (magpakamatay|masaktan ang sarili|magpatiwakal|mamatay)/,
    /\b(?:tableta|kutsilyo|lubid|tumalon|tatalon|dumugo|lason|baril|bibitay|magbibigti)\b.{0,60}?\b(?:sarili|pagpapakamatay|mamatay)\b/,
    /\bmay (plano|paraan|gamit|handa) na ako (para mamatay|para magpakamatay)/,
    /\bbibigyan ko (ng wakas|ng katapusan) (?:(?:ang) )?(sarili|buhay) ko/,
    /\biinom (ng maraming|lahat ng) (gamot|tableta|pills)/,
    /\bhanda na (?:(?:ako) )?(para|na) (mamatay|magpakamatay)/,
    /\bgagawin ko (?:na )?ang plano ko\b/,
    /\b(nagpuputol|nagsusugatsunog|nagsasaktan) (?:(?:ako) )?ng sarili (ko)?/,
  ];
  var distressPatterns = [
    // English
    /\bi (am|feel) (depressed|hopeless|worthless|empty|broken|numb|suicidal|devastated)/,
    /\bi hate (everything|my life|myself|being alive|this world)/,
    /\bi feel (lost|alone|trapped|overwhelmed|tired of everything|like a burden)/,
    /\bnobody (cares|understands|would miss me|loves me)/,
    /\bi am (falling apart|at my limit|on the edge|so tired|exhausted)/,
    /\blife is (pointless|meaningless|not worth it|too hard|unfair)/,
    /\bi (can't|cannot) (go on|continue|keep going|do this)/,
    /\bi feel like (a burden|nothing|nobody|invisible)/,
    /\beverything is (falling apart|too much|hopeless|pointless)/,
    // Tagalog — emotional distress / hopelessness
    /\bpakiramdam ko(ng)? (depresado|walang pag-asa|walang kwenta|walang laman|sira|manhid|basura|pabigat)/,
    /\bkinasusuklaman ko (ang lahat|ang buhay ko|ang sarili ko|ang mabuhay|ang mundo)/,
    /\bpakiramdam ko(ng)? (nawawala|nag-iisa|nakulong|napalibutan|pagod na sa lahat|wala nang pag-asa)/,
    /\bwalang (nagmamalasakit|nakakaunawa|makakapalad kung mawala ako|nagmamahal sa akin)/,
    /\bnasa (gilid|dulo|hangganan|labi) na ako/,
    /\bang buhay (?:(?:ko) )?(?:(?:ay) )?(walang saysay|walang kabuluhan|hindi sulit|masyadong mahirap)/,
    /\bhindi ko na (makayanan|kakayanin) (ito|ang lahat|ang buhay)/,
    /\bpakiramdam ko(ng)? (pabigat|problema|sakit) (?:(?:lang) )?ako (sa lahat|sa mundo)/,
    /\bsobrang (lungkot|sakit|hirap|pagod) ko (?:(?:na|nang|na lang|lang) )?(sa buhay|sa lahat|na)/,
    /\bwalang (mahal sa akin|nagpapahalaga sa akin|nagmamalasakit sa akin)/,
    /\bwala (?:(?:akong) )?(halaga|silbi|kwenta) (sa mundo|sa buhay|sa lahat)/,
    /\bpagod (?:(?:na|nang|na lang|lang) )?(?:(?:na|nang|na lang|lang) )?ako (sa buhay|sa lahat|sa mundo|sa pag-iral)/,
    /\bhindi ko na (kayang ituloy|kayang magpatuloy) (ang buhay|ito)/,
  ];
  var addictionPatterns = [
    // English
    /\bi am (addicted|hooked|dependent) (on|to) (drugs|alcohol|substances|shabu|meth)/,
    /\bi (can't|cannot) stop (using|taking|drinking|smoking)/,
    /\bi (use|take|do) (drugs|shabu|meth|weed|alcohol) (every day|all the time|regularly)/,
    /\bi (need|crave) (drugs|alcohol|shabu|a fix|my fix)/,
    /\bbeen (using|on) (drugs|shabu|meth|substances) (for|since)/,
    // Tagalog — addiction
    /\badik (?:na )?(?:ako|na ako) sa (?:droga|shabu|rugby|alak|sugal|bisyo|solvent|marijuana|damo|vape|yosi|sigarilyo)\b/,
    /\bnaka(-)?(adik|depende) (?:(?:na|nang|na lang|lang) )?ako (sa|kay)/,
    /\bgumagamit (?:(?:na|nang|na lang|lang) )?ako ng (droga|shabu|rugby|solvent|inhalant|alak|sigarilyo)/,
    /\bhindi ko na (mapigilan|mapigil|pigilan) (?:(?:ang) )?(paggamit|pag-inom|pagdadrug)/,
    /\bkailangan ko (?:ng|ang) (?:droga|shabu)\b/,
    /\b(nag-iinject|nag-iinom|nag-iinhale|gumagamit) (?:(?:ako) )?ng (droga|shabu|rugby)/,
    /\b(tulak|dealer|pushers?) (ako|siya|sila)/,
    /\b(nagbebenta|nagbibili) (?:(?:ako) )?ng (droga|shabu)/,
    /\blagi (?:(?:na|nang|na lang|lang) )?(akong|ako) (high|lasing|drugged|naka-shabu)/,
    /\bang (sarap|ganda|galing) ng (shabu|droga|rugby) (para sa akin)?/,
  ];
  var abusePatterns = [
    // English
    /\bi am being (abused|beaten|hurt|harassed|molested|raped)/,
    /\bsomeone (is|has been) (hurting|abusing|threatening|hitting) me/,
    /\b(my parent|my father|my mother|my stepfather|my stepmother|someone) (hits|beats|hurts|abuses) me/,
    /\bi (?:was|got) (?:raped|molested|abused|assaulted|groped|harassed|touched (?:inappropriately|sexually|down there|without (?:my )?consent))\b/,
    /\bi am (scared|afraid) (for my life|to go home|of him|of her|of them)/,
    /\bthey (threatened|will hurt|are going to hurt) me/,
    /\bi am in (danger|trouble|an abusive)/,
    // Tagalog — abuse / violence / danger
    /\b(ginagabatan|niyayabang|binubugbog|sinasapak|sinisipa|tinatampal) (ako|niya|nila)/,
    /\b(sinasalakay|ginagahasa|nangha-harass|nang-aabuso) (ako|niya|nila)/,
    /\bnatatakot (ako|na ako) (sa|kay) (tatay|nanay|stepfather|stepmother|kapitbahay|classmate|guro)/,
    /\btinatakot (ako|niya|nila) (na|ng)/,
    /\b(binubugbog|sinasapak|sinisipa) (?:(?:ako) )?(ng|ni|nina) (tatay|nanay|kuya|ate|stepfather|stepmother)/,
    /\bnaranasan ko (?:(?:ang) )?(pang-aabuso|panggagahasa|pananakit)/,
    /\bmay (nangdadamot|nang-aabuso|nananakit|nangha-harass) sa akin/,
    /\bnangangamba (ako) (para sa buhay ko|na manakit sila sa akin)/,
    /\bligtas (?:(?:ba) )?(ako|ba ako)/,
    /\btulong (?:(?:po|no) )?may (nanakit|nangharang|nang-abuso) sa akin/,
  ];
  var bullyingPatterns = [
    // English
    /\bi am being (bullied|harassed|threatened|cyberbullied|targeted|humiliated)/,
    /\bthey (keep|always|won't stop) (bullying|making fun of|threatening|humiliating|embarrassing|excluding) me/,
    /\bpeople (at school|online|in class|in my grade) (bully|harass|threaten|hurt|mock) me/,
    /\b(classmates?|schoolmates?|batchmates?|friends?) (are|keep) (bullying|threatening|hurting|excluding|mocking) me/,
    /\bsomeone (spread|is spreading) (rumors|lies|photos) (about me|of me)/,
    /\b(group chat|gc|group message) (is|was) (used to|bullying|humiliating|spreading) (me|against me)/,
    /\bthey (post|posted|share|shared) (embarrassing|humiliating) (things|photos|videos) (of|about) me (online|on social media)/,
    /\bi (am|feel) (excluded|left out|ignored|isolated) (by|from) (my class|my classmates|my friends|my group)/,
    // Tagalog — bullying
    /\b(ina-away|inaasar|binubully|tinutukso|niloloko|inaabuso|pinagtatawanan) (?:(?:ako) )?(ng|ni|nina|nila)/,
    /\b(classmate|kaklase|batchmate|grupo) (?:(?:ko) )?(?:(?:ay) )?(nambubully|nananakit|nagbabanta|umaaway) sa akin/,
    /\bpalagi (akong|nilang) (inaabuso|inasar|inaaway|pinagtatawanan)/,
    /\bhindi ako (mapayapang|matahimik na) (pumunta sa school|pumasok|mag-aral)/,
    /\bayaw ko (?:(?:nang) )?(pumasok|pumunta sa school) (dahil|kasi) (sa|natatakot)/,
    /\bnambubully (sa akin|sila sa akin)/,
  ];
  var eatingDisorderPatterns = [
    // English
    /\bi (haven't|have not|don't|did not) (eat|eaten|had food) (in days|for days|today|all day|all week)/,
    /\bi (purge|make myself|force myself) (throw up|vomit|puke)/,
    /\bi (starve|am starving) (myself|on purpose)/,
    /\bi (skip|skipping|avoid|avoiding) (all my meals|eating|food)/,
    /\bi (hate|am disgusted by) (my body|my weight|how i look)/,
    /\bi need to (lose weight|be thinner|be skinnier) (or else|because|so that)/,
    /\b(laxatives|diet pills|purging|binging and purging|binge eating)/,
    /\bi feel (fat|disgusting|gross) (after eating|when i eat|about myself)/,
    /\bi (count|track) every (calorie|bite|piece of food) (obsessively|every day|all the time)/,
    // Tagalog — eating disorder
    /\bhindi (ako|na ako) (kumakain|nakakakain) (ng maayos|nang maayos|sa loob ng|ng ilang araw)/,
    /\bsinisadya ko(ng)? (hindi kumain|mag-starve|ayunan)/,
    /\bnagtatago (?:(?:ako) )?ng (pagkain|food) (para|dahil)/,
    /\bkinasusuklaman ko (?:(?:ang) )?(katawan ko|timbang ko|hitsura ko)/,
    /\b(nagsusuka|pinipilit kong sumuka) (?:(?:ako) )?(pagkatapos kumain|para|dahil)/,
  ];
  var sexualHarmPatterns = [
    // English
    /\bi (was|got|have been) (sexually|inappropriately) (touched|assaulted|harassed|abused|exploited)/,
    /\bsomeone (touched|grabbed|forced|pressured) me (sexually|inappropriately|without consent)/,
    /\b(?:my teacher|my coach|my classmate|my relative|someone|somebody) (?:(?:touched|groped) me\b|(?:forced|pressured) me (?:to (?:have sex|do (?:sexual|it)|send|undress|kiss|touch)|into (?:sex|sending)))/,
    /\b(sent|receiving|sharing) (nude|naked|sexual|explicit) (photos|pictures|videos) (of me|without consent)/,
    /\bi (was|got) (raped|molested|sexually abused)/,
    /\b(sexting|sextortion|nude photos|leaked photos) (of me|involving me|my photos)/,
    /\bsomeone (is blackmailing|blackmailed) me (with|using) (photos|videos|pictures)/,
    /\bonline (predator|grooming|exploitation)/,
    /\bsomeone (older|adult) (wants|wanted|asked|pressured) me to (have sex|do sexual things|send photos)/,
    // Tagalog — sexual harm
    /\b(hinalikan|hinawakan|ginagahasa|nilalasog|pinagsamantalahan) (?:(?:ako) )?(ng|ni|nina)/,
    /\bmay (humawak|humipo|nangdestabo|nang-abuso|nanghalay) sa akin (nang walang pahintulot|ng hindi ko gusto)/,
    /\b(nagpapadala|pinapadalhan|pinipilit) (ng|ako ng) (hubad na larawan|bold na litrato|sexual na content)/,
    /\b(nire-record|nila-livestream|kinukuha ng video) (?:(?:ako) )?(nang hindi ko alam|ng walang pahintulot)/,
    /\bmay (nagbabanta|nagba-blackmail) sa akin (gamit|ng|ng litrato|ng video)/,
  ];
  var gangViolencePatterns = [
    // English
    /\bi am (in|involved in|part of) a (gang|group that fights|barkada that hurts people)/,
    /\b(they|someone) (threatened|is threatening) (to hurt|to kill|to jump) me/,
    /\bi (have|carry|brought) a (weapon|knife|gun|balisong) (to school|with me)/,
    /\b(fight|brawl|rumble) (is happening|will happen|being planned) (at school|near school|after class)/,
    /\bi (was|got) (jumped|stabbed|shot at|threatened at gunpoint)/,
    /\bsomeone (has a gun|brought a knife|has a weapon) (at school|nearby)/,
    /\b(gang|group) (is after|targeting|following) me/,
    // Tagalog — gang / violence
    /\b(miyembro|kasali|nakapasok) (?:(?:ako) )?(sa|ng) (gang|barkada na nag-aaway|grupo na mapanganib)/,
    /\bmay (banta|nagbabanta|naghahanap sa akin) (sa|ng) (gang|grupo)/,
    /\b(may dala|nagdala) (ako|siya|sila) ng (patalim|kutsilyo|baril|armas) (sa eskuwela)?/,
    /\b(away|gulo|rumble) (na|gagawin|mangyayari) (sa|malapit sa) (eskuwela|paaralan)/,
    /\b(sinaksak|tinaboy|pinagbabaril|binalatan) (ako|niya|nila)/,
  ];
  var familyCrisisPatterns = [
    // English
    /\b(my parents|my mom|my dad|my family) (fight|hit each other|hurt each other) (all the time|every night|constantly)/,
    /\bi am (scared|afraid) to go home/,
    /\b(domestic violence|abuse at home) (is happening|in my house|in my family)/,
    /\bmy (parent|father|mother|stepparent) (is|has been) (drinking|drunk|on drugs) (and|then) (hurts|hits|abuses)/,
    /\bi (was|got) (kicked out|thrown out|locked out) (of my house|of my home)/,
    /\bi (?:have no|do not have a|don't have a|have nowhere|haven't had a) (?:place )?(?:to )?(?:sleep|stay|go home|go)\b/,
    /\brunning away (from home|from my family)/,
    /\b(neglected|starved|locked up|isolated) (by my family|at home)/,
    // Tagalog — family crisis
    /\b(nagaaway|nagsasagupaan|nagsasaksakan|nagsasuntukan) (ang|si|sina) (tatay|nanay|magulang|pamilya) (?:(?:ko) )?(palagi|lagi|araw-araw)/,
    /\bnatatakot (?:(?:ako) )?(umuwi|sa bahay) (dahil|kasi)/,
    /\b(lasing|high|nalasing|naka-droga) (ang|si) (tatay|nanay|magulang) ko (at|tapos) (nananakit|umaaway)/,
    /\b(pinalayas|pinaalis|sinibak) (?:(?:ako) )?(sa bahay|ng magulang|ng pamilya)/,
    /\bwala (akong|na akong) (matulungan|matutuluyan|matirhan|puntahan)/,
    /\btumakas (na|na lang) (?:(?:ako) )?(sa bahay|sa pamilya)/,
  ];
  var academicCrisisPatterns = [
    // English
    /\bi am (going to|about to) (fail|drop out|be expelled|get expelled)/,
    /\bi (cheated|was caught cheating|plagiarized) (on a test|in an exam|in school)/,
    /\bi (can't|cannot) (afford|pay for) (school|tuition|my fees) (anymore|this year)/,
    /\bi (might|will) have to (stop|quit|leave) (school|studying) (because|due to)/,
    /\b(teachers?|school staff|principal) (is|are) (harassing|threatening|discriminating against) me/,
    /\bi (feel|am|so) (overwhelmed|crushed|destroyed) by (school|exams|grades|pressure)/,
    // Tagalog — academic crisis
    /\bmababagsak (?:(?:na|nang|na lang|lang) )?(ako|na ako) (sa lahat|sa subject|sa klase)/,
    /\b(mapapalayas|mae-expel|matataboy) (?:(?:na|nang|na lang|lang) )?(?:(?:ako) )?(sa eskuwela|sa paaralan)/,
    /\bhindi (na|ko) (kaya|kayang) (bayaran|tulungan|harapin) (ang|ang bayad sa) (eskuwela|tuition)/,
    /\bkailangan (?:(?:na|nang|na lang|lang) )?(akong) (mag-drop|umalis sa eskuwela|tumigil mag-aral)/,
  ];
  var mentalHealthPatterns = [
    // English
    /\bi (?:can't|cannot) (?:breathe|think straight|function|stop crying|stop shaking)\b/,
    /\bi (feel|am) (like i am going crazy|losing my mind|out of control|like a different person)/,
    /\bi (hear|see|experience) things (that aren't real|that others don't)/,
    /\b(panic attack|anxiety attack|mental breakdown|nervous breakdown)/,
    /\bi (can't|cannot) (stop|control) (my thoughts|my urges|myself)/,
    /\bi (feel|am) (completely numb|emotionally dead|disconnected from everything)/,
    /\bi (haven't|have not) (slept|eaten|left my room|gone outside) (in days|for days|for weeks)/,
    /\bi (am|feel like i am) (disappearing|not real|watching myself from outside)/,
    /\b(medication|meds|pills) (aren't|not) (working|helping) (anymore|at all)/,
    /\bdiagnosed with (depression|anxiety|bipolar|schizophrenia|ptsd|ocd|eating disorder)/,
    // Tagalog — mental health crisis
    /\bhindi (ako|na ako) (makatulog|makakain|makagalaw|makaalis) (ng ilang araw|sa loob ng|nang ilang)/,
    /\bparang (nababaliw|nasisiraan ng ulo|wala na akong kontrol|iba na ako)/,
    /\b(naririnig|nakakakita) (?:(?:ako) )?ng (bagay|tinig|boses) na (hindi totoo|hindi nakikita ng iba)/,
    /\b(panic attack|anxiety attack|mental breakdown) (na naman|palagi|nangyayari)/,
    /\bhindi ko (mapigilan|kontrolin) (?:(?:ang) )?(sarili ko|mga iniisip ko|mga nararamdaman ko)/,
    /\bparang (hindi ko totoo|hindi ako totoo|nanunuod lang ako sa sarili ko)/,
  ];
  var isolationPatterns = [
    // English
    /\bno one (understands|cares|listens|loves me)/,
    /\bi feel (so alone|completely alone|invisible|abandoned|unwanted)/,
    /\bi can't handle this/,
    /\beverything (hurts|is too much|is falling apart)/,
    /\bi (have|has) no (friends|one|purpose|reason to live)/,
    /\bi don't (belong|fit in|matter)/,
    /\bi (feel|am) (like a burden|useless|worthless|a failure)/,
    /\bnobody (would notice|would care|would miss) if i (was gone|disappeared|died)/,
    /\bi (give up|quit|stop trying|can't do this anymore)/,
    // Tagalog — isolation / low distress
    /\bwalang (nakakaintindi|nagpapahalaga|nakikinig|nagmamahal) sa akin/,
    /\bpakiramdam ko(ng)? (sobrang nag-iisa|ganap na nag-iisa|hindi nakikita|abandunado|ayaw sa akin)/,
    /\bhindi ko na (kaya|kayang tiisin) ito/,
    /\blahat ay (masakit|sobra na|laban sa akin)/,
    /\bnag-iisa (ako|na lang ako) (palagi|lagi|sa lahat)/,
    /\bwala (?:(?:akong) )?(kaibigan|kakampi|makapitan|matakbuhan)/,
    /\bhindi (?:(?:ako) )?(kasama|kasali|kabilang) (sa grupo|sa lahat)/,
    /\bpakiramdam ko(ng)? (hindi ako mahalaga|hindi ako kailangan|hindi ako gusto)/,
    /\bstressed (?:(?:na|nang|na lang|lang) )?(?:(?:na|nang|na lang|lang) )?(ako|na ako) (sobra|na)/,
    /\bhindi ko (alam|mahanap) (?:(?:ang) )?(dahilan|rason|paraan) para (magpatuloy|maging masaya)/,
    /\bparang (wala|walang silbi|walang kwenta) (?:(?:na|nang|na lang|lang) )?(ako|ang buhay ko)/,
    /\bwalang (makakapansin|magmamalasakit|makakaalam) kung (mawala|nawala|maging wala) (?:(?:na|nang|na lang|lang) )?ako/,
  ];

  // New patterns added after testing against real phrasing (see tests/corpus.js)
  var selfHarmPatterns = [
    /\bi (?:cut|burn(?:ed|t)?|hurt|hit|scratch(?:ed)?|harm(?:ed)?) myself\b/, /\b(?:cuts?|scars?|marks) on my (?:wrists?|arms?|thighs?|legs?)\b/,
    /\b(?:nag|mag|nagla|magla|pag|pagla)?laslas\w*\b/, /\b(?:naghihiwa|hinihiwa|sinusugatan|sinasaktan|hiniwa) (?:ako |ko )?(?:ng |ang |sa )?(?:aking )?(?:sarili|pulso|braso|kamay|hita)\b/,
    /\b(?:sinasaktan|sinaktan|sinusugatan) ko (?:ang |yung )?(?:aking )?sarili\b/,
  ];
  var passiveIdeationPatterns = [
    /\bgusto (?:ko|kong)(?: (?:na|nang|lang|talaga|sana))* ?(?:na |nang )?(?:mawala|maglaho|hindi na umiral|matulog (?:na lang )?habang buhay)\b/,
    /\bwala na(?:ng)? (?:saysay|kwenta|kuwenta|silbi|dahilan|halaga|patutunguhan|pag-?asa)(?: pa)?(?: ang| para(?: sa)?)? ?(?:buhay ko|aking buhay|mabuhay|ako mabuhay|buhay)\b/,
    /\bi (?:want|wish) to (?:disappear|vanish|not be here|be gone)\b|\bi wish i could (?:just )?disappear\b/,
    /\b(?:nobody|no one) (?:will|would|is going to) (?:even )?(?:miss|care about|notice|remember) me\b/,
    /\bnobody would (?:even )?(?:care|notice|miss me) if i (?:died|was gone|were gone|disappeared|am gone)\b/,
  ];
  var planExtraPatterns = [
    /\b(?:rope|pills?|blade|razor|knife|gun|poison|lubid|lason|gamot)\b[^.!?]{0,30}\b(?:ready|prepared|handa|nakahanda)\b/,
    /\b(?:going to|will|gonna) do it (?:tonight|today|tomorrow|later|this week(?:end)?|soon|now)\b|\bgagawin ko na (?:mamaya|ngayong gabi|bukas|ngayon)\b/,
  ];
  var distressExtraPatterns = [
    /\b(?:lagi|palagi|araw-?araw|gabi-?gabi)(?: na)?(?: lang)? (?:ako|akong|na akong) (?:umiiyak|malungkot|nag-?iisa|takot|kinakabahan|balisa)\b/,
    /\b(?:umiiyak|naiiyak) (?:ako|na lang ako|na ako) (?:lagi|palagi|araw-?araw|gabi-?gabi|tuwing gabi)\b|\bi cry (?:every (?:day|night)|all the time|myself to sleep)\b/,
    /\bi (?:can't|cannot|couldn't) (?:sleep|eat|focus|concentrate)\b|\bhindi (?:na )?(?:ako|ko) (?:makatulog|makakain|makapag-?focus)\b/,
    /\b(?:anxiety|anxious|overthink\w*|insomnia|trauma|traumatized|na-?trauma)\b/,
    /\b(?:sobrang|grabe|super|sobra)(?: na)?(?: ang)? ?(?:stress(?:ed)?|lungkot|pagod|hirap|sakit)\b|\bstressed (?:na )?(?:ako|na ako)\b|\bi am (?:so|really|very|too|super) (?:stressed|sad|lonely|scared|depressed|tired of)\b/,
  ];
  var eatingExtraPatterns = [
    /\b(?:starv(?:e|ed|ing)|purg(?:e|ed|ing)|vomit(?:ed|ing)?|throw(?:ing)? up) (?:myself|on purpose|after (?:eating|meals|every meal))\b/,
    /\b(?:sinusuka|isinusuka) ko (?:ang |yung )?(?:kinain|kinakain|pagkain)\b|\bginugutom ko (?:ang )?sarili\b/,
  ];
  var familyExtraPatterns = [
    /\b(?:pinalayas|pinapalayas|pinaalis|itinakwil|tinakwil|iniwan|inabandona)(?: na)? (?:ako|nila ako|niya ako|kami)\b/,
    /\b(?:kicked|threw|thrown) (?:me )?out (?:of (?:the |my |our )?(?:house|home))?\b/,
  ];
  var dangerPatterns = [
    // someone is threatening or about to hurt the student
    /\b(?:he|she|they|someone|somebody|my [a-z]+(?: [a-z]+)?|(?:a|the|this|that) (?:guy|man|boy|girl|group|gang|student|classmate|teacher))(?: said| says| told me| keeps saying)?(?: that)?(?: (?:he|she|they))? (?:is |are |was |were )?(?:going to|will|would|wants? to|wanted to|threaten(?:s|ed|ing)? to|tried to|is trying to|are trying to) (?:kill|hurt|stab|shoot|beat|rape|harm|hit|choke|strangle|jump|punch) (?:me|us)\b/,
    /\b(?:threaten(?:ed|s|ing)?|threats?) (?:to (?:kill|hurt|stab|shoot|beat|rape|harm) )?(?:me|us|my (?:life|family))\b/,
    new RegExp("\\b" + TL_VERB + "(?: (?:daw|raw|na|rin|din|po|nga|talaga))* (?:ako\\b|(?:nila|niya|mo|nyo|ninyo) (?:na |daw |raw )?ako\\b)"),
    /\bmay (?:gustong|gusto|nagbabanta|nagbabantang|nagtangkang|nagtatangkang|balak|nagbabalak)(?: na)? (?:pumatay|manakit|sumaksak|bumaril|manggahasa|gumahasa|mambugbog|manggulpi|saktan|patayin)(?: sa akin| ako)?\b/,
    /\b(?:someone|somebody|a (?:man|guy|stranger|car)|he|they|some (?:man|guy|people))\b[^.!?]{0,20}?\b(?:follow(?:s|ing|ed)|stalk(?:s|ing|ed)|watching|waiting for) me\b/,
    /\b(?:pinagbabantaan|binabantaan|binantaan|tinatakot|tinakot|sinusundan|hinahabol|inaabangan|tinutukan) (?:po |na |din |rin |daw )*(?:ako|nila ako|niya ako|ako nila|ako niya)\b/,
  ];
  var physicalAbusePatterns = [
    /\b(?:my|our) (?:own )?(?:step ?)?(?:father|dad|daddy|papa|mother|mom|mommy|mama|stepfather|stepdad|stepmother|stepmom|parents?|uncle|aunt|tito|tita|brother|sister|kuya|ate|cousin|grandfather|grandpa|grandmother|grandma|lolo|lola|boyfriend|girlfriend|bf|gf|ex|teacher|coach|guardian|neighbou?r|classmates?)\b[^.!?]{0,25}?\b(?:hits?|beats?|hurts?|abuses?|punch(?:es|ed)?|slaps?|slapped|kicks?|kicked|chokes?|choked|whips?|whipped|burns?|burned|locks?|locked|touch(?:es|ed)?|molest(?:s|ed)?|rap(?:es|ed)|gropes?|groped|harass(?:es|ed)?|threaten(?:s|ed)?|starves?|strangles?|strangled) (?:me|us|my (?:mom|mother|mama|sister|brother|siblings?))\b/,
    /\b(?:sinasaktan|sinaktan|binubugbog|binugbog|ginugulpi|ginulpi|sinasapak|sinapak|sinasampal|sinampal|sinusuntok|sinuntok|sinisipa|sinipa|pinapalo|pinalo|hinahampas|hinampas|sinasakal|sinakal|kinukulong|ikinukulong|kinulong|pinapahirapan|minamaltrato|minaltrato|inaabuso|inabuso|sinasabunutan|sinabunutan|binabato|pinapaso|pinaso|tinatadyakan|tinadyakan|ginugutom|pinagbubuhatan ng kamay|pinagbuhatan ng kamay)(?: (?:po|na|din|rin|lagi|palagi|naman|daw|kasi|nila|niya))* (?:ako|kami|akong|kaming)\b/,
    /\b(?:he|she|they|someone|somebody|(?:my|the|some|those|these) (?:\w+ )?(?:classmates?|students?|boys|girls|guys|seniors?|bull(?:y|ies)|group)) (?:always |keep |keeps |kept |just )?(?:beat|beats|hit|hits|punch(?:ed|es)?|kick(?:ed|s)?|slap(?:ped|s)?|chok(?:ed|es)|attack(?:ed|s)?|jump(?:ed|s)?|mugged|stabbed) (?:me|us)\b/,
    /\b(?:natatakot|takot)(?: na)? (?:ako|akong|na akong|po akong)(?: na)? (?:umuwi|pumasok|sa bahay|sa school|kay (?:tatay|papa|nanay|mama|tito|kuya)|sa (?:tatay|papa|nanay|mama|tito|kuya|stepfather|amain) ko)\b/,
  ];
  var sexualDisclosurePatterns = [
    /\b(?:hinipuan|hinihipuan|hinipo|hinihipo|minolestiya|minomolestiya|minolestya|ginahasa|ginagahasa|nirape|nireyp|nire-rape|rineyp|hinalay|hinahalay|pinagsamantalahan|pinagsasamantalahan|binastos|binabastos|hinubaran|hinuhubaran|sinilipan|sinisilipan|minamanyak|minanyak|tsinansingan|tsinatsansingan|chinansingan|chinachansingan|dinakma|kinapa|kinakapa|ginalaw|ginagalaw|pinilit (?:makipag-?(?:sex|talik)|maghubad|mag-?send))(?: (?:po|na|din|rin|daw|kasi|lagi|palagi|nila|niya))* (?:ako|akong|kami)\b/,
    /\b(?:ako|akong)(?: (?:po|ay|na))* (?:hinipuan|hinihipuan|minolestiya|ginahasa|ginagahasa|nirape|nireyp|hinalay|pinagsamantalahan|binastos|hinubaran|sinilipan|minanyak)\b/,
    /\b(?:hinawakan|hinahawakan|hinipo|hinihipo|hinimas|hinihimas|pinisil|pinipisil|dinakma|dinadakma|hinalikan|hinahalikan|sinilip|sinisilip|pinakita|ipinakita|pinapakita|pinahawak|pinapahawak|pinasubo|pinasok|ipinasok|touch(?:ed|es|ing)?|grab(?:bed|s|bing)?|grop(?:ed|es|ing)|rubb(?:ed|ing)|squeez(?:ed|ing)|show(?:ed|s|ing)?|fingered|licked|kissed|felt)\b[^.!?]{0,45}?\b(?:dibdib|suso|dede|boobs?|breasts?|chest|pwet|puwet|butt|hita|thighs?|ari|pekpek|pepe|puke|puki|kepyas?|tite|titi|burat|etits|private parts?|privates|maselang bahagi|pribadong (?:parte|bahagi)|genitals?|penis|vagina|crotch|singit|under my (?:skirt|shirt|clothes|blouse|shorts)|panty|underwear|bra)\b/,
    /\b(?:blackmail\w*|threaten\w* to (?:post|share|leak|send|spread|upload)|leak(?:ed|ing|s)?|spread(?:ing|s)?|ikakalat|ikinalat|kinalat|kumalat|ipopost|ipo-post|pinost|ipapakalat)\b[^.!?]{0,45}?\b(?:nudes?|naked|sex ?(?:video|tape)|scandal|hubad|private (?:photos?|videos?|pics?))\b/,
    /\b(?:nudes?|scandal|sex ?video|hubad na (?:picture|larawan|litrato|video|pic))\b[^.!?]{0,45}?\b(?:blackmail\w*|ikakalat|ikinalat|kinalat|kumalat|ipopost|pinost|leak\w*|ipapakalat|binebenta|kumakalat)\b/,
    /\b(?:asked|asking|asks|forced|forcing|forces|pressur\w+|pinipilit|pinilit|inuutusan|humihingi|nanghihingi|hinihingan|inuutos)\b[^.!?]{0,35}?\b(?:nudes?|hubad|naked (?:pics?|photos?|pictures?)|to (?:have )?sex|makipag-?sex|makipagtalik|maghubad)\b/,
    /\b(?:he|she|they|someone|my [a-z]+)(?: [a-z]+)? (?:touch(?:ed|es)|grop(?:ed|es)|molest(?:ed|s)|rap(?:ed|es)|harass(?:ed|es)|assault(?:ed|s)|forced himself on|abused) (?:me|us)\b/,
  ];
  var bullyingExtraPatterns = [
    /\b(?:inaasar|inaaway|binubully|binu-bully|binully|tinutukso|pinagtatawanan|pinagtitripan|pinagkakaisahan|iniiwasan|sinisiraan|kinukutya|nilalait|inaapi|minumura|pinapahiya|pinahiya|chinichismis|pinagchichismisan|ginugulo|pinagtutulungan)(?: (?:po|na|lagi|palagi|din|rin|nila|niya|nyo|daw|kasi|lang|araw-araw))* (?:ako|akong|kami)\b/,
    /\b(?:told|tell|tells|telling|said|say|says|saying|texted|messaged|commented)\b[^.!?]{0,35}?\b(?:kill (?:myself|yourself)|go die|i should (?:just )?die|kill your ?self)\b/,
    /\b(?:sinabihan|sinasabihan|sabi|sinabi|pinagsabihan|chat|comment)\b[^.!?]{0,35}?\b(?:magpakamatay|mamatay na|mamatay ka|patay ka na)\b/,
    /\bkill yourself\b|\bgo die\b|\byou should (?:just )?die\b|\bmamatay ka na\b|\bmagpakamatay ka na\b/,
    /\bi (?:am|was|get|got|keep getting|am always|have been) (?:being )?(?:bullied|cyberbullied|harassed|humiliated|mocked|picked on|body ?shamed|outed)\b/,
  ];
  // Reports about someone else ("my friend says she wants to die") — the reporter is not the one at risk,
  // but the counselor must see it just as fast.
  var OTHER = "(?:he|she|they|my (?:best ?)?friend|my classmate|my seatmate|my sister|my brother|my cousin|my (?:bf|gf|boyfriend|girlfriend)|a friend(?: of mine)?|someone i know|one of my (?:friends|classmates))";
  var thirdPersonPatterns = [
    new RegExp("\\b" + OTHER + "\\b[^.!?]{0,40}?\\b(?:wants? to|is going to|are going to|will|said (?:he|she|they) (?:will|would|wants? to|is going to)|tried to|is planning to|plans? to|keeps? saying (?:he|she|they) (?:will|wants? to)|talks? about|is thinking (?:of|about)|thinks? (?:of|about)) (?:kill(?:ing)? (?:himself|herself|themselves|themself)|die\\b|dying|suicide|end(?:ing)? (?:his|her|their) (?:own )?life|hurt(?:ing)? (?:himself|herself|themselves)|jump(?:ing)? off)"),
    /\b(?:cuts?|cutting|hurts?|hurting|harms?|harming|starves?|starving|burns?|burning) (?:himself|herself|themselves)\b/,
    /\b(?:he|she|my friend|my classmate|my sister|my brother|my cousin)\b[^.!?]{0,30}?\b(?:is|was|keeps?|got|gets|has been) (?:being )?(?:abused|beaten|hit|molested|raped|touched|harassed|threatened|bullied|hurt) by\b/,
    /\b(?:gusto|balak|plano)(?:ng)? (?:na |nang )?(?:niya|nya|niyang|nyang|nila|nilang) (?:na |nang )?(?:mamatay|magpakamatay|magpatiwakal)\b/,
    /\b(?:magpapakamatay|nagpakamatay|magpakamatay|naglalaslas|naglaslas|nagbigti|magbibigti|nagtangkang magpakamatay)(?: (?:daw|raw|na|po|rin|din))* (?:siya|sya|sila|(?:ang|yung|ung|si) (?:kaibigan|kaklase|kapatid|pinsan|bestfriend|best friend) ko)\b/,
    /\b(?:kaibigan|kaklase|kapatid|pinsan|bestfriend|best friend) ko\b[^.!?]{0,45}?\b(?:magpakamatay|magpapakamatay|mamatay|naglalaslas|sinasaktan (?:niya |nya )?(?:ang )?sarili|ayaw na (?:niya |nya )?(?:ng |nang )?mabuhay)\b/,
    /\b(?:binubugbog|sinasaktan|inaabuso|minomolestiya|ginagahasa|hinihipuan|binubully|tinatakot) (?:po |daw |raw |na |lagi |palagi )*(?:siya|sya|sila|(?:ang|yung|ung|si) (?:kaibigan|kaklase|kapatid|pinsan) ko)\b/,
  ];
  var pornAddictionPatterns = [
    /\b(?:addicted|adik|hooked|na-?adik|naadik)(?: na)?(?: ako)? (?:to|sa|on) (?:porn\w*|masturbat\w*|sex|jakol|salsal|bold)\b/,
    /\b(?:can't|cannot) stop (?:watching porn\w*|masturbating)\b|\bhindi ko (?:na )?(?:mapigilan|mapigil|matigil)(?: ang)?(?: pag)?(?: ?nood ng)? (?:porn\w*|bold|pagma-?masturbate|pagjajakol|pagsasalsal)\b/,
  ];

  function countHits(list, p) { var n = 0; for (var i = 0; i < list.length; i++) if (list[i].test(p)) n++; return n; }

  // ───────────────────────────── 4. SCORING ─────────────────────────────
  function scorePrepared(p) {
    var score = 0, reasons = [];
    function add(points, reason) { score += points; if (reasons.indexOf(reason) < 0) reasons.push(reason); }
    function group(list, each, reason, cap) {
      var n = countHits(list, p);
      if (n) add(Math.min(n * each, cap || each * 3), reason);
      return n;
    }

    var threat = threatLevel(p);
    if (threat === 'certain') add(16, THREAT_REASON);
    else if (threat === 'possible') add(7, POSSIBLE_THREAT);

    var critical = group(criticalPatterns, 12, 'Direct self-harm / suicidal intent', 24) > 0;
    group(highRiskPatterns,         8, 'Direct self-harm / suicidal intent', 24);
    group(selfHarmPatterns,         8, 'Self-harm', 16);
    group(passiveIdeationPatterns,  8, 'Wish to disappear / passive suicidal thoughts', 16);
    group(planPatterns,             6, 'Possible plan or method', 18);
    group(planExtraPatterns,        7, 'Possible plan or method', 14);
    group(dangerPatterns,          10, 'Threatened or in danger from someone', 20);
    group(thirdPersonPatterns,     12, 'Concern about another student', 24);
    group(physicalAbusePatterns,    8, 'Possible abuse or danger', 16);
    group(abusePatterns,            7, 'Possible abuse or danger', 14);
    group(sexualDisclosurePatterns, 9, 'Sexual harassment, assault, or exploitation', 18);
    group(sexualHarmPatterns,       7, 'Sexual harassment, assault, or exploitation', 14);
    group(distressPatterns,         3, 'Emotional distress / hopelessness', 9);
    group(distressExtraPatterns,    2, 'Emotional distress / hopelessness', 6);
    group(addictionPatterns,        5, 'Substance use / addiction', 10);
    group(pornAddictionPatterns,    4, 'Compulsive behaviour (wants help)', 4);
    group(bullyingPatterns,         4, 'Bullying or harassment', 8);
    group(bullyingExtraPatterns,    4, 'Bullying or harassment', 8);
    group(eatingDisorderPatterns,   5, 'Eating disorder / dangerous diet behavior', 10);
    group(eatingExtraPatterns,      5, 'Eating disorder / dangerous diet behavior', 10);
    group(gangViolencePatterns,     6, 'Gang involvement or violent threat', 12);
    group(familyCrisisPatterns,     5, 'Family crisis or home danger', 10);
    group(familyExtraPatterns,      5, 'Family crisis or home danger', 10);
    group(academicCrisisPatterns,   3, 'Academic or school-related crisis', 6);
    group(mentalHealthPatterns,     4, 'Mental health crisis or breakdown', 8);
    group(isolationPatterns,        2, 'Isolation or high stress', 6);

    // Combination boosters
    if (/\bi want to\b/.test(p) && /\b(?:hurt|kill|die)\b/.test(p)) add(4, 'Strong intent phrase combination');
    if (/\b(?:hurt|kill) (?:myself|my self)\b/.test(p)) add(3, 'Self-directed harm language');
    if (/\bgusto (?:ko|kong|na)\b/.test(p) && /\b(?:mamatay|magpakamatay|masaktan)\b/.test(p)) add(4, 'Strong intent phrase combination');
    if (/\bsarili\b/.test(p) && /\b(?:patayin|papatayin|saktan|sasaktan|sugatan|susugatan|masaktan|putulin)\b/.test(p)) add(3, 'Self-directed harm language');
    if (/\b(?:patayin|saktan)\b[^.!?]{0,12}\b(?:nyo|mo|ninyo|niyo)\b[^.!?]{0,12}\bako\b/.test(p)) add(4, 'Strong intent phrase combination');

    // Keywords (whole words — the old substring check fired on "something", "napatayo", "asawa")
    var kw = function (re) { var m = p.match(re); return m ? m.length : 0; };
    var n;
    if ((n = kw(/\b\w*(?:pakamatay|patiwakal)\w*\b|\bsuicid\w*|\bself-?harm\w*|\bselfharm\w*/g))) add(Math.min(n, 2) * 8, 'Direct self-harm / suicidal intent');
    if ((n = kw(/\b(?:mamatay|overdose|overdosed|nag-?overdose|\w*bigti\w*)\b/g))) add(Math.min(n, 2) * 4, 'Possible plan or method');
    if ((n = kw(/\b(?:patay|lason)\b/g))) add(Math.min(n, 2) * 2, 'Possible plan or method');
    var hasSubstance = kw(/\b(?:shabu|meth|methamphetamine|droga|drugs|inhalants?|solvent|vape|vaping|nagve-?vape|nagvavape|e-?cig(?:arette)?s?|marijuana|weed|chongke|tsongki|ecstasy|cocaine|nag-?shabu|nagshashabu|nagdodroga|nagdo-?droga)\b/g) > 0
                    || /\b(?:rugby|solvent)\b[^.!?]{0,25}\b(?:singhot|sinisinghot|amoy|sniff\w*|inhal\w*|high|gumagamit|adik)\b|\b(?:singhot|sumisinghot|sniff\w*|nagru?rugby|nag-?rugby|gumagamit)\b[^.!?]{0,25}\brugby\b|\brugby boys?\b/.test(p);
    var hasAddiction = /\b(?:adik|na-?adik|naadik|addict|addicted|lulong|nalulong)\b/.test(p);
    var hasDistress = false;
    if (hasSubstance) add(3, 'Substance use / addiction');
    if (hasAddiction) add(2, 'Substance use / addiction');
    if ((n = kw(/\b(?:hopeless|depressed|depression|depresado|depress|breakdown|nababaliw|nasisiraan)\b/g))) { add(Math.min(n, 2) * 2, 'Emotional distress / hopelessness'); hasDistress = true; }
    if (kw(/\b(?:pagod|sawa na|sawang-sawa|napapagod)\b/g)) { add(1, 'Emotional distress / hopelessness'); }
    if (/\b(?:purging|sextortion|balisong)\b/.test(p)) add(4, 'Additional risk signal detected');
    if (/\bcutting myself\b|\bburn(?:ing)? myself\b/.test(p)) add(6, 'Self-harm');
    if (/\brap(?:e|ed|ing|ist)\b|\bmolest\w*|\bsexual(?:ly)? ?(?:assault|abus|harass)\w*|\bsextortion\b|\bgahasa\b|\bpanggagahasa\b/.test(p)) add(6, 'Sexual harassment, assault, or exploitation');
    if (/\bpanic.?attacks?\b|\bmental.?breakdown\b|\bnervous.?breakdown\b|\banxiety.?attacks?\b/.test(p)) add(4, 'Mental health crisis or breakdown');
    if (/\bgangs?\b|\bfrat(?:ernity)?\b|\bbarkada\b[^.!?]{0,30}\b(?:away|gulo)\b|\brumble\b|\bhazing\b/.test(p)) add(4, 'Gang involvement or violent threat');
    if (/\bpurging\b|\bbinge\b.{0,30}\bpurge\b|\bpurge\b.{0,30}\bbinge\b|\bnot eating\b|\bstop(?:ped)? eating\b|\bstarv(?:e|ing) myself\b/.test(p)) add(4, 'Eating disorder / dangerous diet behavior');
    if (hasSubstance && hasAddiction) add(4, 'Confirmed substance addiction');
    if ((hasSubstance || hasAddiction) && (hasDistress || /\b(?:mamatay|magpakamatay|wala nang pag-?asa|sawa na)\b/.test(p))) add(3, 'Substance use with distress');

    var level = 'Low';
    if (score >= 12 || (score >= 9 && reasons.length >= 2)) level = 'High';
    else if (score >= 6 || (score >= 4 && reasons.length >= 2)) level = 'Medium';
    else if (score >= 2) level = 'Low-Medium';

    if (threat === 'certain') level = 'High';
    return { score: Math.min(Math.round(score), 40), level: level, flagged: score >= 3 || level !== 'Low', reasons: reasons, threat: threat, critical: critical };
  }

  function analyzeRisk(text) {
    if (!text || !String(text).trim()) return { score: 0, level: 'Low', flagged: false, reasons: [], threat: null, critical: false };
    var base = applyWordFixes(baseNormalise(text));
    var best = scorePrepared(stripIdioms(base));
    // "diiie", "killlll": also try with stretched letters squeezed
    if (/(.)\1{2,}/.test(base)) {
      var a = scorePrepared(stripIdioms(applyWordFixes(base.replace(/(.)\1{2,}/g, '$1'))));
      var b = scorePrepared(stripIdioms(applyWordFixes(base.replace(/(.)\1{2,}/g, '$1$1'))));
      if (a.score > best.score) best = a;
      if (b.score > best.score) best = b;
    }
    return best;
  }

  // Combine an AI answer with the local rules. The AI may raise or lower ordinary scores, but three
  // floors always hold: a clear threat against others is High; a direct first-person statement of
  // wanting to die is High; and any other local High never drops below Medium.
  function applyFloors(text, ai, local) {
    local = local || analyzeRisk(text);
    var out = {
      score: Math.max(0, Math.min(40, Math.round(Number(ai && ai.score) || 0))),
      level: LEVELS.indexOf(ai && ai.level) >= 0 ? ai.level : 'Low',
      reasons: Array.isArray(ai && ai.reasons) ? ai.reasons.map(String).slice(0, 8) : [],
    };
    out.flagged = typeof (ai && ai.flagged) === 'boolean' ? ai.flagged : (out.score >= 3 || out.level !== 'Low');
    function merge(list) { list.forEach(function (r) { if (out.reasons.indexOf(r) < 0) out.reasons.push(r); }); }
    if (local.threat === 'certain') {
      out.level = 'High'; out.score = Math.max(out.score, 16); out.flagged = true;
      if (!out.reasons.some(function (r) { return /violence|homicid|threat|A4/i.test(r); })) out.reasons.push(THREAT_REASON);
    } else if (local.critical) {
      if (out.level !== 'High') { out.level = 'High'; out.score = Math.max(out.score, 14); }
      out.flagged = true; merge(local.reasons);
    } else if (local.level === 'High' && levelRank(out.level) < levelRank('Medium')) {
      out.level = 'Medium'; out.score = Math.max(out.score, 7); out.flagged = true; merge(local.reasons);
    }
    return out;
  }

  // ───────────────────────────── 5. LANGUAGE FILTER ─────────────────────────────
  // Whole-word matches. Words students need in order to report abuse (rape, sex, nude, drugs…)
  // are deliberately NOT here — the risk rules flag those for the counselor instead.
  var PROFANE_WORDS = [
    // Filipino
    'tangina', 'tanginamo', 'putangina', 'putanginamo', 'putanginang', 'ptangina', 'tngina', 'tnginamo', 'pota', 'potangina', 'potaena', 'putragis',
    'puta', 'putang', 'putangkayo', 'gago', 'gaga', 'gagong', 'gaguhin', 'kagaguhan', 'gagi',
    'hayupak', 'hinayupak', 'hayvop', 'pakshet', 'pakshit', 'pakingshet', 'pakingsit', 'paksit',
    'piste', 'lintek', 'letse', 'leche', 'punyeta', 'punyetang', 'bunyeta', 'bwisit', 'bwisitin',
    'pakyu', 'pakyo', 'packyou', 'packu', 'pokpok', 'pokpokin', 'magpokpok', 'pulpol', 'hampaslupa',
    'tarantado', 'tarantadong', 'manyak', 'manyakin', 'manyakis', 'buraot', 'burauts',
    'kingina', 'kinginamo', 'amputa', 'amputang', 'ampotang', 'ampota', 'inamo', 'inamohin', 'yawa', 'yawang',
    'jakol', 'jakal', 'jakul', 'jacol', 'jakohl', 'jokol', 'djakol', 'nagjajakol', 'nagjajakul', 'nagjajakal', 'najakol',
    'jakulin', 'jakolin', 'jakoling', 'jakutin', 'jijakol', 'jakolan', 'jakolers', 'jakoler',
    'salsal', 'salsalin', 'nagsasal', 'nagsasalsal', 'nagsalsal', 'sarsal', 'salsalan', 'salsalers',
    'kantot', 'kantutin', 'nagkakantot', 'nakantot', 'kantutan', 'kinantot', 'kinalantot',
    'hindot', 'hindotin', 'naghihindot', 'hindutan', 'iyot', 'nagiiyot', 'iyutin', 'iyutan',
    'chupa', 'chupahin', 'nagchuchupa', 'chupaan',
    'tite', 'titi', 'titit', 'burat', 'burats', 'kepyas', 'kepya', 'puki', 'pukiin', 'pekpek', 'pepek',
    // English
    'fuck', 'fucking', 'fucked', 'fucker', 'fuckers', 'fucks', 'fuckup', 'fck', 'fuk', 'fvck', 'fack', 'facking', 'facked', 'facker',
    'phuck', 'phucking', 'phuk', 'phuking', 'fcking', 'fking',
    'shit', 'shitting', 'shitty', 'shits', 'sht', 'shlt', 'bitch', 'bitching', 'bitches', 'bitchy', 'bich', 'biatch',
    'asshole', 'assholes', 'azzhole', 'bastard', 'bastards', 'baztard', 'cunt', 'cunts', 'cvnt',
    'whore', 'whores', 'slut', 'slutty', 'sluts', 'dick', 'dicks', 'dickhead', 'cock', 'cocks', 'cocksucker', 'pussy', 'pussies',
    'motherfucker', 'motherfuckers', 'mofo', 'piss', 'pissed', 'pisser',
    'asshat', 'dipshit', 'jackass', 'jerkoff', 'bullshit', 'wtf', 'stfu', 'gtfo', 'dumbfuck', 'clusterfuck', 'douchebag',
    'pornhub', 'xvideos', 'xnxx', 'porn', 'porno', 'pornography', 'horny', 'horniest', 'hornier',
    'cum', 'cumshot', 'cumming', 'cummed', 'clit', 'clits', 'boobies', 'titties', 'titty',
    'masturbate', 'masturbating', 'masturbation', 'masturbated', 'masterbate', 'masterbating', 'masterbation', 'masterbated',
    'masterbait', 'masterbeyt', 'mastorbeyt', 'masturbayt', 'mastarbeyt', 'mastrubate', 'mastrubation', 'mastrubating',
    'masturbasyon', 'mastorbasyon', 'mastorb', 'masturb', 'mastorbet', 'masterbet', 'mastorbeat', 'masterbeat',
    'nagmamasturbate', 'nagmamasterbate', 'nagmamasturba',
    'wank', 'wanking', 'wanker', 'wankers', 'handjob', 'blowjob', 'dildo', 'dildos',
    'onlyfans', 'hentai', 'ecchi', 'threesome', 'foursome', 'gangbang',
    // Slurs
    'nigger', 'niggers', 'nigga', 'niggas', 'niga', 'chink', 'gook', 'spic', 'wetback', 'kike', 'raghead', 'towelhead', 'sandnigger', 'zipperhead',
    'tranny', 'shemale', 'faggot', 'faggots', 'fag', 'fagot', 'retard', 'retarded', 'retards', 'tard',
  ];
  var PROFANE_PHRASES = [
    'tang ina', 'tang ina mo', 'putang ina', 'putang ina mo', 'anak ng puta', 'gawa ng puta', 'anak ng bitch', 'hampas lupa',
    'mag jakol', 'mag salsal', 'mag masturbate', 'mag masterbate', 'ass hole', 'bull shit', 'jerk off', 'jack off', 'jacking off',
    'hand job', 'blow job', 'gang bang', 'only fans', 'dumb fuck', 'cluster fuck',
  ];
  // Long, unmistakable roots are also caught inside longer words ("nakakaputangina", "motherfucking")
  var PROFANE_ROOTS = ['putangina', 'tangina', 'kantot', 'hindot', 'jakol', 'salsal', 'motherfuck', 'bullshit', 'pakyu', 'punyeta', 'tarantado', 'kingina', 'fuck', 'pakshet', 'masturbat', 'masterbat'];
  // Harmless look-alikes
  var SAFE_PHRASES = [/\bcum laude\b/g, /\bleche flan\b/g, /\blady gaga\b/g, /\bgaga (?:over|about)\b/g, /\bmoby dick\b/g, /\bcock ?(?:fight\w*|pit|roach\w*|tail\w*)\b/g, /\bpeacock\w*\b/g, /\bpissed off\b/g];

  var profWords = null, profCollapsed = null, profPhrases = null;
  function squeeze(w) { return w.replace(/(.)\1+/g, '$1'); }
  function buildProfanity() {
    profWords = {}; profCollapsed = {}; profPhrases = [];
    PROFANE_WORDS.forEach(function (w) { profWords[w] = 1; if (w.length >= 4) profCollapsed[squeeze(w)] = w; });
    PROFANE_PHRASES.forEach(function (ph) { profPhrases.push(ph.split(' ')); });
  }
  function cleanToken(raw) {
    // strip punctuation at both ends FIRST ("Tangina!" used to become "tanginai" and slip through)
    var core = raw.replace(/^[^a-z0-9@$]+|[^a-z0-9@$!|]+$/gi, '').replace(/[!|]+$/g, '').toLowerCase();
    var hadLeet = /[0-9@$!|]/.test(core);
    var w = core.replace(/[4@]/g, 'a').replace(/8/g, 'b').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[5$]/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
    return { w: w, hadLeet: hadLeet };
  }
  function isProfaneWord(w, rawHadRepeat) {
    if (!w) return false;
    if (profWords[w]) return true;
    // stretched spelling: "fuuuck", "gagooo" — only when letters were actually repeated
    if (rawHadRepeat) { var s = squeeze(w); if (profCollapsed[s] && !SAFE_SQUEEZED[w]) return true; }
    if (w.length >= 6) for (var i = 0; i < PROFANE_ROOTS.length; i++) if (w.indexOf(PROFANE_ROOTS[i]) >= 0) return true;
    return false;
  }
  // real words whose squeezed form collides with a listed word
  var SAFE_SQUEEZED = { cook: 1, cooks: 1, cooked: 1, book: 1, good: 1, pass: 1, sheet: 1, shoot: 1, cool: 1, peep: 1, deck: 1, putt: 1, mitt: 1 };

  // Returns [start, end] spans of profane text in the ORIGINAL string.
  function findProfanity(text) {
    if (!text) return [];
    if (!profWords) buildProfanity();
    var s = String(text), lowered = s.toLowerCase();
    var safe = lowered;
    SAFE_PHRASES.forEach(function (re) { safe = safe.replace(re, function (m) { return new Array(m.length + 1).join(' '); }); });
    // "puke" is Filipino slang only with a Filipino marker next to it; alone it is the English word
    safe = safe.replace(/\bpuke\b(?! (?:mo|ko|niya|nya|nila|ng|ni|nyo))/g, function (m, off) { return /(?:ang|yung|ung|sa|ng|mo|iyong) $/.test(safe.slice(0, off)) ? m : '    '; });
    var spans = [], toks = [], re = /[^\s.,;:?"()\[\]{}<>\/\\*_+=~`^\-]+/g, m;
    while ((m = re.exec(safe))) toks.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
    var words = toks.map(function (t) { var c = cleanToken(t.raw); t.w = c.w; return c.w; });
    toks.forEach(function (t) {
      if (isProfaneWord(t.w, /(.)\1/.test(t.w))) spans.push([t.start, t.end]);
      else if (t.w === 'puke') spans.push([t.start, t.end]);
    });
    // starred-out spellings: f*ck, sh*t, p*ta
    var star = /\b(?:f[*#]+c?k\w*|sh[*#]+t|b[*#]+tch|p[*#]+ta(?:ngina)?|g[*#]+go|t[*#]+ngina)(?![a-z])/g, sm;
    while ((sm = star.exec(lowered))) spans.push([sm.index, sm.index + sm[0].length]);
    // spaced-out letters: "f u c k", "p.u.t.a"
    var i = 0;
    while (i < toks.length) {
      if (toks[i].w.length === 1) {
        var j = i, run = '';
        while (j < toks.length && toks[j].w.length === 1) { run += toks[j].w; j++; }
        if (run.length >= 3 && (profWords[run] || profCollapsed[squeeze(run)])) spans.push([toks[i].start, toks[j - 1].end]);
        i = j;
      } else i++;
    }
    // phrases
    profPhrases.forEach(function (ph) {
      for (var k = 0; k + ph.length <= words.length; k++) {
        var ok = true;
        for (var q = 0; q < ph.length; q++) if (words[k + q] !== ph[q]) { ok = false; break; }
        if (ok) spans.push([toks[k].start, toks[k + ph.length - 1].end]);
      }
    });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    spans.forEach(function (sp) { var last = merged[merged.length - 1]; if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push(sp.slice()); });
    return merged;
  }
  function containsProfanity(text) { return findProfanity(text).length > 0; }
  function maskProfanity(text) {
    var spans = findProfanity(text); if (!spans.length) return text;
    var s = String(text), out = '', pos = 0;
    spans.forEach(function (sp) {
      out += s.slice(pos, sp[0]);
      var w = s.slice(sp[0], sp[1]);
      out += w.charAt(0) + w.slice(1).replace(/[^\s]/g, '*');
      pos = sp[1];
    });
    return out + s.slice(pos);
  }

  // The gate used for every post, request and chat message:
  //   • clean text                         → allowed as typed
  //   • profanity + serious risk (Medium+) → allowed AS TYPED (the counselor must see it)
  //   • profanity + mild signal            → allowed, swear words masked
  //   • profanity + no risk signal at all  → refused
  // A student who may need help is never turned away for rough language.
  function languageGate(text, risk) {
    var profane = containsProfanity(text);
    if (!profane) return { block: false, masked: false, text: text };
    risk = risk || analyzeRisk(text);
    if (levelRank(risk.level) >= levelRank('Medium')) return { block: false, masked: false, text: text };
    if (risk.flagged) return { block: false, masked: true, text: maskProfanity(text) };
    return { block: true, masked: false, text: text };
  }
  function shouldBlockForLanguage(text) { return languageGate(text).block; }

  return {
    LEVELS: LEVELS, levelRank: levelRank, maxLevel: maxLevel, THREAT_REASON: THREAT_REASON,
    analyzeRisk: analyzeRisk, detectRiskRegex: analyzeRisk, detectThreatToOthers: detectThreatToOthers, applyFloors: applyFloors,
    containsProfanity: containsProfanity, findProfanity: findProfanity, maskProfanity: maskProfanity,
    languageGate: languageGate, shouldBlockForLanguage: shouldBlockForLanguage, _prepare: prepare,
  };
});
