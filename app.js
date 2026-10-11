// ── LOW-END DEVICE MODE: disable decorative animation when the device is weak ──
(function(){
  try {
    var weak = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
               (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
               (navigator.connection && (navigator.connection.saveData || /2g/.test(navigator.connection.effectiveType||'')));
    if (weak) document.documentElement.classList.add('lite');
  } catch(e) {}
})();

    
    // ── SECURITY NOTE ──────────────────────────────────────────────────────────
    // Firebase client-side config keys (apiKey, appId, etc.) are NOT secret —
    // they are identifiers, not passwords. Real security is enforced via
    // Firestore Security Rules on the Firebase console. This app requires:
    //
    // rules_version = '2';
    // service cloud.firestore {
    //   match /databases/{database}/documents {
    //     // Only authenticated users can read/write their own data
    //     match /users/{uid} {
    //       allow read, write: if request.auth != null && request.auth.uid == uid;
    //     }
    //     match /postings/{id} {
    //       allow read: if request.auth != null;
    //       allow create: if request.auth != null;
    //       allow update, delete: if request.auth != null &&
    //         (resource.data.authorId == request.auth.token.email ||
    //          request.auth.token.email.matches('.*guidance.*') ||
    //          request.auth.token.email.matches('.*counselor.*') ||
    //          request.auth.token.email in ['admin@qhsafety.demo','youradminemail@gmail.com']);
    //     }
    //     match /consultations/{id} {
    //       allow read: if request.auth != null &&
    //         (resource.data.authorId == request.auth.token.email ||
    //          request.auth.token.email.matches('.*guidance.*') ||
    //          request.auth.token.email.matches('.*counselor.*') ||
    //          request.auth.token.email in ['admin@qhsafety.demo','youradminemail@gmail.com']);
    //       allow create: if request.auth != null;
    //       allow update, delete: if request.auth != null &&
    //         (resource.data.authorId == request.auth.token.email ||
    //          request.auth.token.email.matches('.*guidance.*') ||
    //          request.auth.token.email.matches('.*counselor.*') ||
    //          request.auth.token.email in ['admin@qhsafety.demo','youradminemail@gmail.com']);
    //     }
    //     match /feedback/{id} {
    //       allow read: if request.auth != null;
    //       allow create: if request.auth != null;
    //       allow delete: if request.auth != null &&
    //         request.auth.token.email in ['admin@qhsafety.demo','youradminemail@gmail.com'];
    //     }
    //     match /logs/{id} {
    //       allow read, write: if request.auth != null;
    //     }
    //     match /counselors/{id} {
    //       allow read, write: if request.auth != null;
    //     }
    //   }
    // }
    // ──────────────────────────────────────────────────────────────────────────

    const firebaseConfig = {
      apiKey:"AIzaSyD4N8D_FT_Oy8umm_79tQJiy24uWxbJ_KA",
      authDomain:"qhsafety-57c55.firebaseapp.com",
      databaseURL:"https://qhsafety-57c55-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId:"qhsafety-57c55",
      storageBucket:"qhsafety-57c55.firebasestorage.app",
      messagingSenderId:"666664597822",
      appId:"1:666664597822:web:92f3f430aff2e20e49946f",
      measurementId:"G-C11871B9MR"
    };
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db   = firebase.firestore();

    // ── EMAIL NOTIFICATIONS (server-side via /api/email) ──
    // All keys (EmailJS, guidance email) are stored in Vercel environment variables.
    // The browser never sees them.

    async function authHeaders() {
      const h = { 'Content-Type': 'application/json' };
      try { if (auth.currentUser) h['Authorization'] = 'Bearer ' + await auth.currentUser.getIdToken(); } catch(e) {}
      return h;
    }

    async function callEmailAPI(payload) {
      try {
        const res = await fetch('/api/email', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(payload),
        });
        if (!res.ok) console.warn('[QHsafety] Email API returned', res.status);
      } catch(e) {
        console.warn('[QHsafety] Email notification failed (non-critical):', e);
      }
    }

    // Notify student when guidance replies to their posting
    async function notifyStudentOfGuidanceReply(studentEmail, postTitle, message) {
      if (!studentEmail || studentEmail === 'Anonymous' || studentEmail.startsWith('anon_')) return;
      await callEmailAPI({
        type: 'student_reply',
        to_email: studentEmail,
        to_name: studentEmail.split('@')[0],
        post_title: postTitle,
        guidance_message: message,
        app_url: window.location.href,
        sent_at: new Date().toLocaleString(),
      });
    }

    // Notify student when guidance replies in their consultation chat
    async function notifyStudentOfConsultationReply(studentEmail, consultReason, message) {
      if (!studentEmail || studentEmail === 'Anonymous' || studentEmail.startsWith('anon_')) return;
      await callEmailAPI({
        type: 'consultation_reply',
        to_email: studentEmail,
        to_name: studentEmail.split('@')[0],
        post_title: `Consultation: ${consultReason}`,
        guidance_message: message,
        app_url: window.location.href,
        sent_at: new Date().toLocaleString(),
      });
    }

    // Alert guidance when a high-risk submission is detected
    async function notifyGuidanceOfHighRisk(type, authorEmail, reason, description, aiScore, riskLevel, reasons) {
      await callEmailAPI({
        type: 'high_risk',
        alert_type: type,
        author: authorEmail,
        reason: reason,
        description: description,
        ai_score: aiScore,
        risk_level: riskLevel,
        risk_reasons: (reasons || []).join(', '),
        app_url: window.location.href,
        sent_at: new Date().toLocaleString(),
      });
    }

    const defaultConfig = {
      hero_title:'QHsafety', hero_subtitle:'For the Junior and Senior High School students of Quirino High School',
      welcome_text:'Welcome Back', background_color:'#f8f6f1', surface_color:'#ffffff',
      text_color:'#2c3e50', primary_action_color:'#ffee58', secondary_action_color:'#80deea',
      font_family:'DM Sans', font_size:16
    };
    let config = {...defaultConfig};
    let currentRole=null, currentUserEmail='', activeSidebarItem='Dashboard', darkMode=localStorage.getItem('qh_dark_mode')==='true', showCreateGuidanceForm=false;
    let postLimit=25, consultLimit=25;
    let postings=[], showPostingForm=false, postingTitle='', postingContent='', postingError='', postingPriority='Medium';
    let consultationPostings=[], showConsultationForm=false, consultationReason='', consultationDescription='', consultationPriority='Medium', consultationError='', consultationGradeLevel='';
    let consultationContactPref='chat', consultationMoodLevel=3;
    // The student's grade is asked once and remembered on this device (per account); both forms share it.
    let postingContactPref='chat';
    const GRADES = [7, 8, 9, 10, 11, 12];                      // Junior and Senior High School, as in the paper
    const STRANDS = ['STEM', 'ABM', 'HUMSS', 'GAS', 'TVL'];    // EDIT: the strands your school offers (asked only for Grades 11 and 12)
    const isSHS = (g) => /^Grade (11|12)$/.test(g || '');
    const AGE_MIN = 11, AGE_MAX = 21;                          // the last one is shown as "21+"
    const GRADE_RE = /^Grade (7|8|9|10|11|12)$/;
    let studentStrand = '', studentAge = 0, _profFor = null;
    function profGet(k) { try { return localStorage.getItem('qh_' + k + '_' + (currentUserEmail || 'guest')) || ''; } catch (e) { return ''; } }
    function profSet(k, v) { try { localStorage.setItem('qh_' + k + '_' + (currentUserEmail || 'guest'), String(v)); } catch (e) {} }
    function pickStrand(v) { studentStrand = (studentStrand === v || !STRANDS.includes(v)) ? '' : v; profSet('strand', studentStrand); render(); }
    function pickAge(v) { const n = parseInt(v, 10); studentAge = n >= AGE_MIN && n <= AGE_MAX ? n : 0; profSet('age', studentAge || ''); }
    function ageLabel(n) { n = Number(n) || 0; return !n ? '' : n >= AGE_MAX ? AGE_MAX + '+' : String(n); }
    // "Grade 12 · STEM · 17 yrs" — what staff see on a card
    function demoLabel(i) { return [i.gradeLevel, i.strand, i.age ? ageLabel(i.age) + ' yrs' : ''].filter(Boolean).join(' · '); }
    function gradeKey() { return 'qh_grade_' + (currentUserEmail || 'guest'); }
    function savedGrade() {
      try { const g = localStorage.getItem(gradeKey()) || ''; if (GRADE_RE.test(g)) return g; } catch (e) {}
      const last = consultationPostings.concat(postings).filter(i => i.authorId === currentUserEmail && GRADE_RE.test(i.gradeLevel || '')).sort((a, b) => b.timestamp - a.timestamp)[0];
      return last ? last.gradeLevel : '';
    }
    function pickGrade(g) { if (!GRADE_RE.test(g)) return; consultationGradeLevel = g; try { localStorage.setItem(gradeKey(), g); } catch (e) {} render(); }
    function ensureGrade() {
      if (currentRole !== 'student') return '';
      if (!GRADE_RE.test(consultationGradeLevel)) consultationGradeLevel = savedGrade();
      if (_profFor !== currentUserEmail) {
        _profFor = currentUserEmail;
        const st = profGet('strand'); studentStrand = STRANDS.includes(st) ? st : '';
        const a = parseInt(profGet('age'), 10); studentAge = a >= AGE_MIN && a <= AGE_MAX ? a : 0;
      }
      return '';
    }
    // Grade (needed for a consultation), strand and age (both optional) — shared by the two student forms
    function aboutYouFields() {
      ensureGrade();
      const c = config, lab = 'display:block;font-size:13px;font-weight:600;color:' + c.text_color + ';margin-bottom:8px';
      const chip = (on) => 'flex:1;min-width:64px;white-space:nowrap;padding:8px 10px;border-radius:8px;font-size:12px;font-weight:600;border:2px solid ' + (on ? c.primary_action_color : c.text_color + '22') + ';background:' + (on ? c.primary_action_color + '22' : 'transparent') + ';color:' + c.text_color + ';text-align:center';
      const opt = ' <span style="font-weight:400;color:' + c.text_color + '88">(' + tr('pOptional') + ')</span>';
      return '<div class="mb-3"><label style="' + lab + '">' + tr('cGrade') + '</label><div class="flex gap-2 flex-wrap" role="group" aria-label="' + tr('cGrade') + '">' +
        GRADES.map(g => '<button aria-pressed="' + (consultationGradeLevel === 'Grade ' + g) + '" data-grade="' + g + '" onclick="pickGrade(\'Grade ' + g + '\')" style="' + chip(consultationGradeLevel === 'Grade ' + g) + '">Grade ' + g + '</button>').join('') + '</div></div>' +
        (!isSHS(consultationGradeLevel) ? '' : '<div class="mb-3"><label style="' + lab + '">' + tr('pStrand') + opt + '</label><div class="flex gap-2 flex-wrap" role="group" aria-label="' + tr('pStrand') + '">' +
        STRANDS.map(v => '<button aria-pressed="' + (studentStrand === v) + '" data-strand="' + _esc(v) + '" onclick="pickStrand(\'' + _esc(v) + '\')" style="' + chip(studentStrand === v) + '">' + _esc(v) + '</button>').join('') + '</div></div>') +
        '<div class="mb-4"><label for="qh-age" style="' + lab + '">' + tr('pAge') + opt + '</label><select id="qh-age" data-keep onchange="pickAge(this.value)" style="padding:9px 12px;border:1px solid ' + c.text_color + '22;border-radius:8px;background:' + c.background_color + ';color:' + c.text_color + ';font-size:14px;min-width:120px"><option value="">—</option>' +
        Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, k) => AGE_MIN + k).map(a => '<option value="' + a + '"' + (studentAge === a ? ' selected' : '') + '>' + ageLabel(a) + '</option>').join('') + '</select></div>';
    }
    let showMeetScheduler={}, consultMeetDraft={date:'',time:'',link:'',notes:''};
    // Attachment limits (Firebase free tier safe)
    const ATTACH_MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
    const ATTACH_MAX_PER_CONSULT = 3;
    const ATTACH_MAX_TOTAL_PER_USER = 5;
    let consultSessionRating={}, consultSessionFeedback={};
    let postingChatDraft={}, consultationChatDraft={}, expandedPost=null, expandedConsult=null;
    let feedbackList=[], showFeedbackForm=false, feedbackRating=5, feedbackMessage='', feedbackError='';
    let systemLogs=[], logFilter='all', postingSearchQuery='', mobileDrawerOpen=false;
    let loginEmail='', loginPassword='', loginError='', isAuthenticated=false, selectedRoleForLogin=null;
    let currentAuthFlow='login', signupEmail='', signupPassword='', signupConfirmPassword='', signupError='';
    let showLandingSettings=false, showForgotPassword=false, forgotPasswordEmail='', forgotPasswordError='', forgotPasswordSuccess='';
    let firestoreUnsubscribes=[];
    let isAnonymous=false;
    let postingAbout='me', postingAboutWho='';
    let announcementBusy=false;
    let appLang = localStorage.getItem('qh_lang') || 'en';
    const app=document.getElementById('app');

    const T = {
      en: {
        postings:'Postings', consultations:'Consultations', feedback:'Feedback',
        settings:'Settings', dashboard:'Dashboard', problems:'Problems', logs:'Logs', users:'Users',
        newPosting:'New Posting', newConsultation:'Request Consultation', leaveFeedback:'Leave Feedback',
        publish:'Publish', cancel:'Cancel', submit:'Submit', delete:'Delete',
        title:'Title', content:'Content', priority:'Priority Level', search:'Search postings...',
        low:'Low', medium:'Medium', high:'High',
        postGuide:'<strong>Posting guide:</strong> Share what you\'re going through honestly. You can post anonymously. The guidance office may reply with support directly on your post.',
        noPostings:'No postings yet', noConsultations:'No consultations yet', noFeedback:'No feedback yet',
        by:'By', markResolved:'Mark Resolved', markDone:'Mark Done',
        appearance:'Appearance', darkMode:'Dark Mode', language:'Language', account:'Account',
        logout:'Logout', leaveAnon:'Leave Anonymous Session',
        welcomeBack:'Welcome Back', student:'Student', counselor:'Counselor', admin:'Administrator',
        yourPosts:'Your posts', totalPosted:'Total posted', yourRequests:'Your requests',
        totalRequests:'Total requests', yourFeedback:'Your feedback', totalFeedback:'Total submitted',
        needAttention:'Need attention', welcomeMsg:'Welcome to QHsafety',
        dashHint_student:'Submit postings, request consultations, and leave feedback.',
        dashHint_guidance:'Monitor student postings, manage consultations, and review feedback.',
        dashHint_admin:'View feedback, logs, and manage settings.',
        guidanceReply:'Reply to this posting:', send:'Send',
        msgFromGuidance:'Message from Guidance Office',
        reason:'Reason / Topic', descConcern:'Describe your concern in detail...',
        submitRequest:'Submit Request', resolved:'Resolved',
        rating:'Rating', writeFeedback:'Write your feedback...',
        deleteAllPostings:'Delete All Postings', deleteAllConsult:'Delete All Consultations', deleteAllFeedback:'Delete All Feedback',
        signedInAs:'Signed in as Anonymous',
        anonNote:'You are browsing anonymously. Your identity is not saved. Return on the same device to see your posts.',
        loggedInAs:'Logged in as',
        selectRole:'Select your role to get started:',
        continueAnon:'Continue Anonymously',
        anonSubtext:'Anonymous users can post and consult without an account. Your identity stays hidden.',
        howToUse:'How to Use', howToUseDesc:'Submit reports, book consultations, and track your sessions securely.',
        termsPrivacy:'Terms & Privacy', termsDesc:'Your data stays confidential and is only accessible to authorized guidance staff.',
        weCare:'We Care', weCareDesc:'Every report is reviewed. Every student matters. Help is always one click away.',
        aboutMission:'About Our Mission',
        aboutDesc:'QHsafety is an AI-powered web-based system for student mental health monitoring and crisis intervention, made for the Junior and Senior High School (Grade 7 to 12) students of Quirino High School. Report a concern anonymously or with your name, request a consultation, and message the guidance office directly.',
        langSetting:'Language / Wika',
        logs:'Logs', users:'Users', by:'By', markDone:'Mark Done', storage:'Storage',
        'low-medium':'Low-Medium', loading:'Loading…', noMatch:'No postings match your search.',
      },
      tl: {
        postings:'Mga Post', consultations:'Mga Konsultasyon', feedback:'Feedback',
        settings:'Mga Setting', dashboard:'Dashboard', problems:'Mga Problema', logs:'Logs', users:'Mga User',
        newPosting:'Bagong Post', newConsultation:'Humiling ng Konsultasyon', leaveFeedback:'Mag-iwan ng Feedback',
        publish:'I-publish', cancel:'Kanselahin', submit:'Isumite', delete:'Burahin',
        title:'Pamagat', content:'Nilalaman', priority:'Antas ng Prioridad', search:'Hanapin ang post...',
        low:'Mababa', medium:'Katamtaman', high:'Mataas',
        postGuide:'<strong>Gabay sa pag-post:</strong> Ibahagi ang iyong nararamdaman nang tapat. Maaari kang mag-post nang hindi nagpapakilala. Maaaring sumagot ang gabay ng paaralan dito.',
        noPostings:'Wala pang mga post', noConsultations:'Wala pang konsultasyon', noFeedback:'Wala pang feedback',
        by:'Ni', markResolved:'Markahan bilang Nalutas', markDone:'Tapos Na',
        appearance:'Hitsura', darkMode:'Madilim na Mode', language:'Wika', account:'Account',
        logout:'Mag-logout', leaveAnon:'Umalis sa Anonymous na Session',
        welcomeBack:'Maligayang Pagbabalik', student:'Estudyante', counselor:'Counselor', admin:'Administrator',
        yourPosts:'Iyong mga post', totalPosted:'Kabuuang nai-post', yourRequests:'Iyong mga kahilingan',
        totalRequests:'Kabuuang kahilingan', yourFeedback:'Iyong feedback', totalFeedback:'Kabuuang isinumite',
        needAttention:'Nangangailangan ng pansin', welcomeMsg:'Maligayang pagdating sa QHsafety',
        dashHint_student:'Mag-post, humiling ng konsultasyon, at mag-iwan ng feedback.',
        dashHint_guidance:'Subaybayan ang mga post ng estudyante, pamahalaan ang mga konsultasyon.',
        dashHint_admin:'Tingnan ang feedback, logs, at pamahalaan ang mga setting.',
        guidanceReply:'Sumagot sa post na ito:', send:'Ipadala',
        msgFromGuidance:'Mensahe mula sa Gabay ng Paaralan',
        reason:'Dahilan / Paksa', descConcern:'Ilarawan ang iyong alalahanin nang detalyado...',
        submitRequest:'Isumite ang Kahilingan', resolved:'Nalutas',
        rating:'Rating', writeFeedback:'Isulat ang iyong feedback...',
        deleteAllPostings:'Burahin Lahat ng Post', deleteAllConsult:'Burahin Lahat ng Konsultasyon', deleteAllFeedback:'Burahin Lahat ng Feedback',
        signedInAs:'Naka-sign in bilang Anonymous',
        anonNote:'Nagba-browse ka nang hindi nagpapakilala. Hindi nase-save ang iyong pagkakakilanlan. Bumalik sa parehong device para makita ang iyong mga post.',
        loggedInAs:'Naka-login bilang',
        selectRole:'Piliin ang iyong papel para magsimula:',
        continueAnon:'Magpatuloy nang Anonymous',
        anonSubtext:'Maaaring mag-post at kumonsulta ang mga anonymous user nang walang account. Nananatiling nakatago ang iyong pagkakakilanlan.',
        howToUse:'Paano Gamitin', howToUseDesc:'Mag-submit ng ulat, mag-book ng konsultasyon, at subaybayan ang iyong mga session.',
        termsPrivacy:'Mga Tuntunin at Privacy', termsDesc:'Ang iyong data ay kumpidensyal at accessible lamang ng mga awtorisadong tauhan ng gabay.',
        weCare:'Nagmamalasakit Kami', weCareDesc:'Ang bawat ulat ay sinusuri. Mahalaga ang bawat estudyante. Laging isang click lang ang tulong.',
        aboutMission:'Tungkol sa Aming Misyon',
        aboutDesc:'Ang QHsafety ay isang AI-powered na web-based system para sa pagsubaybay sa mental health ng mga estudyante at agarang pagtugon sa krisis, para sa mga estudyante ng Junior at Senior High School (Grade 7 hanggang 12) ng Quirino High School. Mag-ulat nang hindi nagpapakilala o may pangalan, humiling ng konsultasyon, at direktang makipag-usap sa guidance office.',
        langSetting:'Language / Wika',
        logs:'Mga Log', users:'Mga User', storage:'Storage',
        'low-medium':'Mababa-Katamtaman', loading:'Naglo-load…', noMatch:'Walang post na tumutugma.',
      }
    };
    function tr(key) { return (T[appLang]||T.en)[key] || T.en[key] || key; }


    // ── RISK DETECTION ──
// The rules themselves live in risk-engine.js, one file shared by this page, the server (/api/analyze)
// and the tests (node tests/risk.test.js) so the three can never disagree.
const { analyzeRisk, detectThreatToOthers, containsProfanity, maskProfanity, languageGate, applyFloors, levelRank, maxLevel } = window.QHRisk;
const detectRiskRegex = analyzeRisk;
const detectRisk = analyzeRisk;

// Second opinion from the server-side AI. Never throws and never hangs: on any failure the local rules stand.
async function detectRiskAI(text, local) {
  local = local || analyzeRisk(text);
  let ctrl = null, timer = null;
  try {
    ctrl = ('AbortController' in window) ? new AbortController() : null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), 12000);
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ text: String(text || '').slice(0, 1800) }),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!response.ok) { console.warn('[QHsafety] AI analyze error:', response.status); return local; }
    const parsed = await response.json();
    if (parsed && typeof parsed.score === 'number' && parsed.level && Array.isArray(parsed.reasons)) {
      // The AI may raise or lower ordinary scores; a clear threat stays High and a local High never drops below Medium.
      return applyFloors(text, parsed, local);
    }
    console.warn('[QHsafety] Unexpected AI response shape');
  } catch (e) {
    console.warn('[QHsafety] AI risk detection unavailable, using local rules:', e && e.name);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return local;
}

// A student's own "High priority" only stands when the content is rated High.
function priorityFor(chosen, risk) {
  const p = chosen || 'Medium';
  return (p === 'High' && risk.level !== 'High') ? 'Medium' : p;
}

// Email + push to the guidance office. Fire-and-forget: the student never waits on it.
function alertGuidance(kind, authorLabel, heading, body, risk, id) {
  notifyGuidanceOfHighRisk(kind, authorLabel, heading, body, risk.score, risk.level, risk.reasons).catch(() => {});
  sendOneSignalPush(
    `🚨 ${risk.level.toUpperCase()} RISK ${kind.toUpperCase()} — AI Score: ${risk.score}`,
    `${authorLabel}: "${heading}" — ${(risk.reasons || []).slice(0, 2).join(', ')}`,
    id, kind === 'Posting' ? 'posting' : 'consultation', risk.level, risk.score, risk.reasons
  ).catch(() => {});
  addLog(`🚨 ${risk.level}-risk ${kind.toLowerCase()} alert sent`, authorLabel, 'warning');
}

// Runs AFTER the item is already saved and on screen. A local High alerts at once;
// everything else waits for the AI's verdict so counselors are not paged for nothing.
async function refineRiskInBackground(col, item, text, local, kind, heading, body, chosenPriority) {
  const authorLabel = item.author;
  let alerted = false;
  const alertOnce = (risk) => { if (alerted) return; alerted = true; alertGuidance(kind, authorLabel, heading, body, risk, item.id); };
  if (local.level === 'High') alertOnce(local);
  const risk = await detectRiskAI(text, local);
  if (risk.level !== local.level || risk.score !== local.score || risk.reasons.join('|') !== local.reasons.join('|')) {
    db.collection(col).doc(String(item.id)).update({
      aiScore: risk.score, riskLevel: risk.level, flagged: !!risk.flagged, reasons: risk.reasons,
      priority: priorityFor(chosenPriority, risk)
    }).catch(e => console.warn('[QHsafety] could not store refined risk:', e && e.code));
  }
  if (risk.level === 'High' || risk.level === 'Medium') alertOnce(risk);
  // the AI saw something the local rules did not: show the student where to get help now
  if (levelRank(risk.level) >= levelRank('Medium') && levelRank(local.level) < levelRank('Medium') && !document.getElementById('qh-help')) maybeShowSupport(risk, !!item.aboutOther);
  if (risk.flagged) addLog('⚠ Flagged ' + kind.toLowerCase() + ' (' + ((risk.reasons || []).join(', ') || 'Sensitive content') + ')', authorLabel, 'warning');
}

// A student can reveal something serious in a chat reply long after the first post.
// Chat messages are now checked too, and the item is raised (never lowered) when they do.
function escalateFromChat(col, id, msg) {
  if (currentRole !== 'student') return;
  const r = analyzeRisk(msg);
  if (levelRank(r.level) < levelRank('Medium')) return;
  const list = col === 'postings' ? postings : consultationPostings;
  const item = list.find(x => String(x.id) === String(id)) || {};
  if (levelRank(r.level) <= levelRank(item.riskLevel)) return;      // already at this level — no second alarm
  const reasons = [...new Set([...(item.reasons || []), ...r.reasons])];
  const risk = { level: r.level, score: Math.max(Number(item.aiScore || 0), r.score), reasons };
  db.collection(col).doc(String(id)).update({ riskLevel: risk.level, aiScore: risk.score, flagged: true, reasons }).catch(() => {});
  const kind = col === 'postings' ? 'Posting' : 'Consultation';
  maybeShowSupport(r, !!item.aboutOther);
  alertGuidance(kind, item.author || (isAnonymous ? 'Anonymous' : currentUserEmail), (item.title || item.reason || 'Chat message'), msg, risk, id);
}

// Language check used by every post, request and chat message. Returns the text to store, or null if refused.
function passLanguageGate(text, risk) {
  const g = languageGate(text, risk);
  return g.block ? null : g.text;
}
const LANGUAGE_REFUSAL = 'That wording can\'t be posted. Please say it another way — if something is wrong, tell us what happened and it will go straight through.';

// Re-check stored items: anything saved before the threat rules existed is raised to High on load,
// and guidance writes the correction back once. Memoised, so a snapshot of 150 items costs nothing on repeat.
const _threatFixed = new Set();
const _threatMemo = new Map();
function upgradeThreatRisk(d, kind) {
  try {
    if (d.riskLevel === 'High') return d;
    const txt = kind === 'posting' ? (d.title + ' ' + d.content) : (d.reason + ' ' + d.description);
    const memoKey = kind + d.id + ':' + txt.length;
    let isThreat = _threatMemo.get(memoKey);
    if (isThreat === undefined) { isThreat = detectThreatToOthers(txt); if (_threatMemo.size > 2000) _threatMemo.clear(); _threatMemo.set(memoKey, isThreat); }
    if (isThreat) {
      d.riskLevel = 'High';
      d.aiScore = Math.max(Number(d.aiScore || 0), 16);
      d.flagged = true;
      d.reasons = [...new Set([...(d.reasons || []), window.QHRisk.THREAT_REASON])];
      const key = kind + d.id;
      if (currentRole === 'guidance' && !_threatFixed.has(key)) {
        _threatFixed.add(key);
        const col = kind === 'posting' ? 'postings' : 'consultations';
        db.collection(col).doc(String(d.id)).update({ riskLevel: 'High', aiScore: d.aiScore, flagged: true, reasons: d.reasons }).catch(()=>{});
        try { notifyGuidanceOfHighRisk(kind === 'posting' ? 'Posting' : 'Consultation', d.author || 'Unknown', kind === 'posting' ? d.title : d.reason, kind === 'posting' ? d.content : d.description, d.aiScore, 'High', d.reasons).catch(()=>{}); } catch(e) {}
      }
    }
  } catch(e) {}
  return d;
}

// Everything read from Firestore passes through here, so one malformed document
// (wrong type, missing field, hand-made id) can never crash a counselor's screen.
const PRIORITIES = ['Low', 'Medium', 'High'];
function cleanDoc(d, kind) {
  if (!d || !/^\d{1,20}$/.test(String(d.id))) return null;
  const str = (v) => (v == null ? '' : String(v));
  d.priority  = PRIORITIES.includes(str(d.priority).trim()) ? str(d.priority).trim() : 'Medium';
  d.riskLevel = window.QHRisk.LEVELS.includes(str(d.riskLevel).trim()) ? str(d.riskLevel).trim() : 'Low';
  d.aiScore   = Number(d.aiScore) || 0;
  d.strand    = str(d.strand).slice(0, 24);
  { const ag = Math.round(Number(d.age)); d.age = ag >= 10 && ag <= 30 ? ag : 0; }
  d.reasons   = Array.isArray(d.reasons) ? d.reasons.map(str) : [];
  d.timestamp = Number(d.timestamp) || 0;
  d.author    = str(d.author);
  d.authorId  = str(d.authorId);
  d.chatMessages = Array.isArray(d.chatMessages) ? d.chatMessages.filter(m => m && typeof m === 'object') : [];
  if (kind === 'posting') { d.title = str(d.title); d.content = str(d.content); d.gradeLevel = str(d.gradeLevel); }
  else {
    d.reason = str(d.reason); d.description = str(d.description);
    d.status = str(d.status).trim() === 'Done' ? 'Done' : 'Pending';
    d.gradeLevel = str(d.gradeLevel);
    const r = Math.round(Number(d.sessionRating)); d.sessionRating = r >= 1 && r <= 5 ? r : 0;
    const m = Math.round(Number(d.studentMood));   d.studentMood   = m >= 1 && m <= 5 ? m : 0;
  }
  return upgradeThreatRisk(d, kind);
}
function stars(n) { n = Math.max(0, Math.min(5, Math.round(Number(n) || 0))); return '★'.repeat(n) + '☆'.repeat(5 - n); }
function newDocId() { return Date.now() * 1000 + Math.floor(Math.random() * 1000); }
function safeHttpUrl(u) {
  u = String(u || '').trim(); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch (e) { return ''; }
}

// ── URGENCY SCORE (for sorting — higher = more urgent) ──
function getUrgencyScore(item) {
  const prioMap = { High: 350, Medium: 120, Low: 0 };
  const riskMap = { High: 250, Medium: 80, "Low-Medium": 30, Low: 0 };

  let base = (prioMap[(item.priority || 'Low').trim()] || 0) +
             (riskMap[(item.riskLevel || 'Low').trim()] || 0) +
             Number(item.aiScore || 0);

  // Bonus for multiple risk signals
  if (item.reasons && item.reasons.length >= 2) base += 40;
  if (item.urgent) base += 300;

  return Math.round(base);
}

// ── GLOW CLASS (guidance-only) ──
function getGlowClass(item, isPending) {
  if (currentRole !== 'guidance' || !isPending) return '';

  const r = (item.riskLevel || '').trim();
  const p = (item.priority || '').trim();
  const score = Number(item.aiScore || 0);

  const isHighRisk = r === 'High';
  const isMedRisk  = r === 'Medium';
  const isHighPrio = p === 'High';
  const isMedPrio  = p === 'Medium';

  // Critical: High risk + High priority OR very high AI score
  if ((isHighRisk && isHighPrio) || score >= 12) return 'guidance-critical';
  // High risk regardless of priority
  if (isHighRisk) return 'guidance-high-risk';
  // High priority regardless of risk
  if (isHighPrio) return 'guidance-high-priority';
  // Medium risk OR medium priority with some AI score
  if (isMedRisk || (isMedPrio && score >= 4)) return 'guidance-medium-risk';

  return '';
}

    // ── LOGGING ──
    async function addLog(action,user,type) {
      user=user||'system';type=type||'info';
      const id=Date.now()*1000+Math.floor(Math.random()*1000);
      const log={id,action,user,type,time:new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}),timestamp:Date.now()};
      try{await db.collection('logs').doc(String(id)).set(log);}
      catch(e){systemLogs.unshift(log);if(currentRole==='admin')scheduleRender();}
    }

    // ── AUTH ──
    // ── AUTH FUNCTIONS ──

// ── ADMIN ACCOUNT CHECKER ─────────────────────────────────────────────────────
let _acLastUid = null;

function _acShow(type, html) {
  const el = document.getElementById('acResult');
  if (!el) return;
  el.style.display = 'block';
  // Use semi-transparent tints so they work in both light and dark mode
  if (type === 'success') {
    el.style.background = '#2e7d3222'; el.style.border = '1px solid #66bb6a55'; el.style.color = darkMode ? '#a5d6a7' : '#1b5e20';
  } else if (type === 'error') {
    el.style.background = '#c6282822'; el.style.border = '1px solid #ef9a9a55'; el.style.color = darkMode ? '#ef9a9a' : '#b71c1c';
  } else {
    el.style.background = '#1565c022'; el.style.border = '1px solid #90caf955'; el.style.color = darkMode ? '#90caf9' : '#0d47a1';
  }
  el.innerHTML = html;
}

async function adminCheckAccount() {
  const email    = (document.getElementById('acEmail').value    || '').trim().toLowerCase();
  const password = (document.getElementById('acPassword').value || '').trim();
  const wantRole = (document.getElementById('acRole').value     || '');
  const fixBtn   = document.getElementById('acFixBtn');
  const checkBtn = document.getElementById('acCheckBtn');
  _acLastUid = null;
  if (fixBtn) fixBtn.style.display = 'none';
  if (!email || !password) { _acShow('error', '❌ Enter both email and password.'); return; }

  if (checkBtn) { checkBtn.disabled = true; checkBtn.innerHTML = '⏳ Checking...'; }
  try {
    // Use a secondary app so admin session is not disturbed
    const tempApp  = firebase.initializeApp(firebase.app().options, 'ac-check-' + Date.now());
    const tempAuth = tempApp.auth();
    const uc = await tempAuth.signInWithEmailAndPassword(email, password);
    const uid = uc.user.uid;
    _acLastUid = uid;
    const verified = uc.user.emailVerified;
    await tempAuth.signOut();
    tempApp.delete().catch(()=>{});

    const snap = await db.collection('users').doc(uid).get();
    const hasDoc = snap.exists;
    const storedRole = hasDoc ? (snap.data().role || '— no role field —') : null;

    let lines = [];
    lines.push(`<strong>UID:</strong> <code style="font-size:11px;word-break:break-all">${_esc(uid)}</code>`);
    lines.push(`<strong>Email verified:</strong> ${verified ? '✅ Yes' : '⚠️ No'}`);
    lines.push(`<strong>Firestore doc:</strong> ${hasDoc ? '✅ Exists' : '❌ Missing'}`);
    lines.push(`<strong>Stored role:</strong> <strong>${_esc(storedRole || 'none')}</strong>`);

    if (wantRole) {
      if (!hasDoc || storedRole !== wantRole) {
        lines.push(`<br>⚠️ Role mismatch or missing. Click <strong>Fix Role</strong> to set it to <strong>${_esc(wantRole)}</strong>.`);
        if (fixBtn) { fixBtn.style.display = 'inline-flex'; fixBtn.textContent = `🔧 Fix → set role to "${wantRole}"`; }
        _acShow('error', lines.join('<br>'));
      } else {
        lines.push(`<br>✅ Role matches! This account should log in correctly as <strong>${_esc(wantRole)}</strong>.`);
        _acShow('success', lines.join('<br>'));
      }
    } else {
      _acShow('info', lines.join('<br>'));
    }
  } catch(e) {
    _acShow('error', '❌ ' + _esc(e.message || 'Login failed. Check email and password.'));
  }
  if (checkBtn) { checkBtn.disabled = false; checkBtn.innerHTML = iconSvg('search', ' style="width:15px;height:15px"') + ' Check Account'; }
}

async function adminFixAccount() {
  const email    = (document.getElementById('acEmail').value    || '').trim().toLowerCase();
  const password = (document.getElementById('acPassword').value || '').trim();
  const wantRole = (document.getElementById('acRole').value     || '');
  const fixBtn   = document.getElementById('acFixBtn');
  if (!wantRole)   { _acShow('error', '❌ Select a role first.'); return; }
  if (!_acLastUid) { _acShow('error', '❌ Run Check first.'); return; }

  if (fixBtn) { fixBtn.disabled = true; fixBtn.textContent = '⏳ Fixing...'; }
  try {
    const tempApp  = firebase.initializeApp(firebase.app().options, 'ac-fix-' + Date.now());
    const tempAuth = tempApp.auth();
    const uc = await tempAuth.signInWithEmailAndPassword(email, password);
    const uid = uc.user.uid;
    await tempAuth.signOut();
    tempApp.delete().catch(()=>{});

    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      await db.collection('users').doc(uid).update({ role: wantRole, email });
    } else {
      await db.collection('users').doc(uid).set({ email, role: wantRole, createdAt: Date.now() });
    }

    addLog(`Admin fixed role for ${email} → ${wantRole}`, currentUserEmail, 'success');
    if (fixBtn) { fixBtn.style.display = 'none'; fixBtn.disabled = false; }
    _acShow('success', `✅ Done! Role for <strong>${_esc(email)}</strong> is now <strong>${_esc(wantRole)}</strong>. They can log in normally.`);
  } catch(e) {
    if (fixBtn) { fixBtn.disabled = false; fixBtn.textContent = '🔧 Fix Role'; }
    _acShow('error', '❌ Fix failed: ' + _esc(e.message));
  }
}
// ─────────────────────────────────────────────────────────────────────────────


// Roles are stored in Firestore /users/{uid}.role and trusted over email heuristics.
// The hardcoded admin list is a bootstrap fallback only (for the very first admin
// before any Firestore user document exists). All other role checks go to Firestore.
const BOOTSTRAP_ADMIN_EMAILS = ['admin@qhsafety.demo', 'youradminemail@gmail.com'];

async function resolveRoleFromFirestore(uid, email) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists && snap.data().role) return snap.data().role;
  } catch(e) { /* Firestore read failed — fall through to bootstrap */ }
  // Bootstrap: only hardcoded admins get elevated roles without a Firestore doc
  if (BOOTSTRAP_ADMIN_EMAILS.includes(email)) return 'admin';
  return 'student'; // default — never grant elevated access by email string pattern
}
// ─────────────────────────────────────────────────────────────────────────────

// ── SIGN-IN ──
// Students may only use these email domains (add your school's Google Workspace domain here if it has one).
const STUDENT_EMAIL_DOMAINS = ['gmail.com'];
function isAllowedStudentEmail(email) { return STUDENT_EMAIL_DOMAINS.some(d => String(email || '').toLowerCase().endsWith('@' + d)); }

let authBusy = '';            // '', 'login', 'google', 'signup', 'reset' — drives the button spinners
let signInFlowActive = false; // stops the auto-login listener from racing an explicit sign-in

// Shared by email/password and Google sign-in: checks the role, then opens the app.
async function finishSignIn(user, selectedRole, viaGoogle) {
  const email = (user.email || '').toLowerCase();
  const fail = async (msg) => { try { await auth.signOut(); } catch (e) {} loginError = msg; };

  // ── Authoritative role lookup from Firestore (not email string) ──
  let docExists = null, actualRole = null;
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    docExists = snap.exists;
    if (snap.exists && snap.data().role) actualRole = snap.data().role;
  } catch (e) { /* read failed — fall through to bootstrap/default below */ }
  if (!actualRole) actualRole = BOOTSTRAP_ADMIN_EMAILS.includes(email) ? 'admin' : 'student';

  if (selectedRole !== actualRole) {
    const names = { student: 'Student', guidance: 'Counselor', admin: 'Administrator' };
    return fail(`Access denied: this account is registered as <strong>${names[actualRole] || 'Student'}</strong>, not ${names[selectedRole] || _esc(selectedRole)}. Go back and choose the right role.`);
  }
  if (actualRole === 'student' && !isAllowedStudentEmail(email)) {
    return fail('🔒 Only Gmail accounts (@gmail.com) are allowed for students.');
  }
  // Google has already verified the address; password accounts must click the emailed link first.
  if (actualRole === 'student' && !viaGoogle && !user.emailVerified) {
    let resent = false;
    try { await user.sendEmailVerification(); resent = true; } catch (e) {}
    return fail('📧 Email not verified. ' + (resent ? 'We just sent you a <strong>new verification link</strong> — ' : '') + 'please check your <strong>inbox or spam/junk folder</strong> and click the link before logging in. Or use <strong>Continue with Google</strong> to skip this step.');
  }
  // First Google sign-in for a student: create their profile (never touches an existing role).
  if (viaGoogle && actualRole === 'student' && docExists === false) {
    try { await db.collection('users').doc(user.uid).set({ email, role: 'student', provider: 'google', createdAt: Date.now() }); }
    catch (e) { console.warn('[QHsafety] could not create user profile:', e && e.code); }
    addLog(`New student account created with Google: ${email}`, email, 'success');
  }

  currentUserEmail = email;
  currentRole = actualRole;
  isAuthenticated = true;
  loginError = ''; loginPassword = '';
  activeSidebarItem = localStorage.getItem('qh_last_page') || 'Dashboard';
  localStorage.setItem('qh_saved_role', actualRole);
  if (actualRole === 'guidance') registerAsCounselor();
  isAnonymous = false; _lastActive = Date.now();
  loadSeen(); startOverdueWatch();
  loadDataFromFirestore();
  addLog(`Logged in as ${actualRole}` + (viaGoogle ? ' (Google)' : ''), email, 'info');
  setTimeout(handleDeepLink, 1000);
}

async function handleLogin(selectedRole) {
  if (authBusy) return;
  // a password manager can fill the boxes without firing an input event
  const emailEl = document.getElementById('li-email'), passEl = document.getElementById('li-pass');
  if (emailEl && emailEl.value) loginEmail = emailEl.value;
  if (passEl && passEl.value) loginPassword = passEl.value;
  if (!(loginEmail || '').trim() || !loginPassword) { loginError = '❌ Please enter your email and password.'; render(); return; }
  loginError = ''; authBusy = 'login'; signInFlowActive = true;
  render();
  try {
    const uc = await auth.signInWithEmailAndPassword((loginEmail || '').trim().toLowerCase(), loginPassword);
    await finishSignIn(uc.user, selectedRole, false);
  } catch (error) {
    loginError = friendlyAuthError(error.code, error.message);
  } finally {
    authBusy = ''; signInFlowActive = false;
    render();
  }
}

// ── QUICK GOOGLE SIGN-IN ──
// One tap, no password and no verification email. Needs the Google provider switched on in
// Firebase Console → Authentication → Sign-in method (see README).
function googleProvider() {
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}
async function handleGoogleSignIn(role) {
  if (authBusy) return;
  role = role || selectedRoleForLogin || 'student';
  selectedRoleForLogin = role; currentAuthFlow = 'login'; showForgotPassword = false;
  loginError = ''; authBusy = 'google'; signInFlowActive = true;
  render();
  try {
    const uc = await auth.signInWithPopup(googleProvider());
    await finishSignIn(uc.user, role, true);
  } catch (e) {
    const code = e && e.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') {
      // Popups are blocked (common inside in-app browsers): fall back to a full-page redirect.
      try { sessionStorage.setItem('qh_google_role', role); await auth.signInWithRedirect(googleProvider()); return; }
      catch (e2) { loginError = friendlyAuthError(e2 && e2.code, e2 && e2.message); }
    } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') {
      loginError = '';   // they simply closed the window
    } else {
      loginError = friendlyAuthError(code, e && e.message);
    }
  } finally {
    authBusy = ''; signInFlowActive = false;
    render();
  }
}
// Completes the redirect fallback when the page loads again.
function resumeGoogleRedirect() {
  let role = null;
  try { role = sessionStorage.getItem('qh_google_role'); sessionStorage.removeItem('qh_google_role'); } catch (e) {}
  if (!role) return;
  selectedRoleForLogin = role; authBusy = 'google'; signInFlowActive = true; render();
  auth.getRedirectResult()
    .then(res => (res && res.user) ? finishSignIn(res.user, role, true) : null)
    .catch(e => { loginError = friendlyAuthError(e && e.code, e && e.message); })
    .then(() => { authBusy = ''; signInFlowActive = false; render(); });
}

function friendlyAuthError(code, fallback) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return '❌ Incorrect email or password. If you just signed up, verify your email first before logging in.';
    case 'auth/wrong-password':
      return '❌ Wrong password. Please try again or use "Forgot Password?" to reset it.';
    case 'auth/user-not-found':
      return '❌ No account found with that email. Please sign up first, or check the email you entered.';
    case 'auth/invalid-email':
      return '❌ That does not look like a valid email address. Please check and try again.';
    case 'auth/invalid-password':
      return '❌ Incorrect password. Please try again or use "Forgot Password?" to reset it.';
    case 'auth/user-disabled':
      return '⛔ This account has been disabled. Please contact your school administrator.';
    case 'auth/too-many-requests':
      return '⏳ Too many failed attempts. Your account is temporarily locked — wait a few minutes, then try again or reset your password.';
    case 'auth/network-request-failed':
      return '🌐 Network error. Please check your internet connection and try again.';
    case 'auth/email-already-in-use':
      return '⚠️ This email is already registered. Go to Login instead, or use "Forgot Password?" if you forgot it.';
    case 'auth/weak-password':
      return '🔒 Password is too weak — use at least 6 characters.';
    case 'auth/admin-restricted-operation':
    case 'auth/operation-not-allowed':
      return '⛔ This sign-in method is not switched on yet. Ask your administrator to enable it in Firebase → Authentication → Sign-in method.';
    case 'auth/unauthorized-domain':
      return '⛔ This website address is not authorised for sign-in yet. The administrator must add it in Firebase → Authentication → Settings → Authorized domains.';
    case 'auth/account-exists-with-different-credential':
      return '⚠️ An account with this email already exists. Log in with your email and password instead.';
    case 'auth/popup-blocked':
      return '⚠️ Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    case 'auth/missing-password':
      return '❌ Please enter your password.';
    case 'auth/missing-email':
      return '❌ Please enter your email address.';
    default:
      return '❌ Something went wrong (' + _esc(code || 'unknown') + '). Please try again. If this keeps happening, contact your administrator.';
  }
}


function getOrCreateAnonId() {
  let id = localStorage.getItem('qh_anon_id');
  if (!id) {
    id = 'anon_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('qh_anon_id', id);
  }
  return id;
}

async function handleSignup() {
  if (authBusy) return;
  signupError = '';

  const email = signupEmail.trim().toLowerCase();
  const password = signupPassword.trim();
  const confirm = signupConfirmPassword.trim();

  // Validation
  let problem = '';
  if (!email || !password || !confirm) problem = 'All fields are required.';
  else if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) problem = 'Please enter a valid email address.';
  else if (!isAllowedStudentEmail(email)) problem = '🔒 Only Gmail accounts (@gmail.com) are allowed to register.';
  else if (password.length < 6) problem = 'Password must be at least 6 characters.';
  else if (password !== confirm) problem = 'Passwords do not match.';
  // Only students can self-register
  else if (selectedRoleForLogin !== 'student') problem = 'Only students can self-register. Guidance and Admin accounts are created by administrators.';
  if (problem) { signupError = problem; render(); return; }

  authBusy = 'signup'; signInFlowActive = true; render();
  try {
    const uc = await auth.createUserWithEmailAndPassword(email, password);
    // Store user profile in Firestore
    await db.collection('users').doc(uc.user.uid).set({
      email,
      role: 'student',
      createdAt: Date.now()
    });

    // Send email verification
    await uc.user.sendEmailVerification();

    // Sign out immediately — user must verify email before logging in
    await auth.signOut();

    signupEmail = ''; signupPassword = ''; signupConfirmPassword = '';
    currentAuthFlow = 'login';
    loginEmail = email;
    addLog(`New student account created (pending verification): ${email}`, email, 'success');
    showSuccessModal('Almost there', `A verification email was sent to <strong>${_esc(email)}</strong>.<br><br><strong>Can't find it?</strong> Please check your:<ul style="text-align:left;margin:10px 0 0 0;padding-left:20px;line-height:2;list-style:disc"><li><strong>Inbox</strong></li><li><strong>Spam / Junk</strong> folder</li><li><strong>Primary</strong> tab (Gmail users)</li></ul><br>The email is sent by Firebase on behalf of QHsafety. Click the verification link, then come back to log in.`);
  } catch (error) {
    signupError = friendlyAuthError(error.code, error.message);
  } finally {
    authBusy = ''; signInFlowActive = false;
    render();
  }
}

// ── XSS PREVENTION HELPER ────────────────────────────────────────────────────
// Use _esc() whenever inserting untrusted (user-supplied) strings into innerHTML.
// Trusted static strings (tr(), template literals with no user data) are fine as-is.
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// ─────────────────────────────────────────────────────────────────────────────

// ── EMAIL MASKING (for logs display) ──
function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return local[0] + '***@' + domain;
  const visible = local.slice(0, 3);
  const masked = '*'.repeat(Math.min(local.length - 3, 5));
  return visible + masked + '@' + domain;
}

// ── MODAL SYSTEM ──
let _modalResolve = null;
let _modalReturnFocus = null;

function _getModalColors(type) {
  if (type === 'error')   return { bg:'#fdecea', color:'#c62828', icon:'alert-triangle' };
  if (type === 'warning') return { bg:'#fff3e0', color:'#e65100', icon:'alert-triangle' };
  if (type === 'success') return { bg:'#e8f5e9', color:'#2e7d32', icon:'check' };
  return { bg:'#e3f2fd', color:'#1565c0', icon:'info' };
}

function _openModal(title, body, type, opts) {
  opts = opts || {};
  const overlay = document.getElementById('qh-modal-overlay');
  const iconWrap = document.getElementById('qh-modal-icon-wrap');
  const inputEl  = document.getElementById('qh-modal-input');
  const btnsEl   = document.getElementById('qh-modal-btns');
  const c = _getModalColors(type);
  _modalReturnFocus = document.activeElement;
  iconWrap.style.background = c.bg;
  iconWrap.style.color = c.color;
  iconWrap.innerHTML = iconSvg(c.icon, ' style="width:24px;height:24px"');
  document.getElementById('qh-modal-title').textContent = title;
  document.getElementById('qh-modal-body').innerHTML = body;
  inputEl.style.display = opts.input ? 'block' : 'none';
  inputEl.value = '';
  if (opts.input) inputEl.placeholder = opts.placeholder || '';
  btnsEl.innerHTML = opts.buttons;
  overlay.classList.add('open');
  setTimeout(() => { const f = opts.input ? inputEl : btnsEl.querySelector('[data-autofocus]') || btnsEl.querySelector('button'); if (f) f.focus(); }, 60);
}

function showModal(title, body, type) {
  if (_modalResolve) { _modalResolve(false); _modalResolve = null; }
  _openModal(title, body, type || 'info', { buttons: `<button class="qh-modal-btn qh-modal-btn-secondary" data-autofocus onclick="closeModal()">OK</button>` });
}

function showSuccessModal(title, body) {
  showModal(title, body, 'success');
}

function closeModal() {
  document.getElementById('qh-modal-overlay').classList.remove('open');
  if (_modalResolve) { const r = _modalResolve; _modalResolve = null; r(false); }
  try { if (_modalReturnFocus && document.contains(_modalReturnFocus)) _modalReturnFocus.focus(); } catch (e) {}
}

// Returns a Promise<boolean> — true if user confirmed
function confirmModal(title, body, type, confirmLabel) {
  return new Promise(resolve => {
    if (_modalResolve) _modalResolve(false);
    _modalResolve = resolve;
    _openModal(title, body, type || 'warning', { buttons: `
      <button class="qh-modal-btn qh-modal-btn-secondary" data-autofocus onclick="_resolveModal(false)">Keep</button>
      <button class="qh-modal-btn qh-modal-btn-primary" onclick="_resolveModal(true)">${_esc(confirmLabel || 'Delete')}</button>` });
  });
}

// Returns a Promise<string|null>
function promptModal(title, body, type) {
  return new Promise(resolve => {
    if (_modalResolve) _modalResolve(null);
    _modalResolve = resolve;
    _openModal(title, body, type || 'warning', { input: true, placeholder: 'Type DELETE to confirm', buttons: `
      <button class="qh-modal-btn qh-modal-btn-secondary" onclick="_resolveModal(null)">Cancel</button>
      <button class="qh-modal-btn qh-modal-btn-primary" onclick="_resolveModal(document.getElementById('qh-modal-input').value)">Confirm</button>` });
  });
}

function _resolveModal(value) {
  document.getElementById('qh-modal-overlay').classList.remove('open');
  if (_modalResolve) { const r = _modalResolve; _modalResolve = null; r(value); }
  try { if (_modalReturnFocus && document.contains(_modalReturnFocus)) _modalReturnFocus.focus(); } catch (e) {}
}

// Esc or a click on the backdrop closes the dialog (counts as "cancel")
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('qh-modal-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
  else if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'qh-modal-input') {
    e.preventDefault(); _resolveModal(document.activeElement.value);
  }
});
document.addEventListener('click', (e) => { if (e.target && e.target.id === 'qh-modal-overlay') closeModal(); });

// ── TOASTS ── small confirmations that do not need an "OK" click
function toast(message, type) {
  let host = document.getElementById('qh-toasts');
  if (!host) { host = document.createElement('div'); host.id = 'qh-toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'qh-toast' + (type ? ' qh-toast-' + type : '');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 4500 : 2400);
}

// Full-size view of an image attachment
function openAttachment(el) {
  const src = el && el.getAttribute('src');
  if (!src || !/^data:image\//.test(src)) return;
  const v = document.createElement('div');
  v.className = 'qh-viewer';
  v.onclick = () => v.remove();
  const img = document.createElement('img');
  img.src = src; img.alt = el.getAttribute('alt') || 'Attachment';
  v.appendChild(img);
  document.body.appendChild(v);
}

// Fixed createAdminAccount
// Uses a secondary Firebase app instance so creating the account does NOT
// sign the current admin out (Firebase Auth side-effect of createUserWithEmailAndPassword).
async function createAdminAccount() {
  const email = document.getElementById('newAdminEmail').value.trim().toLowerCase();
  const password = document.getElementById('newAdminPassword').value.trim();

  if (!email || !password || password.length < 6) {
    showModal("Input Error", "Please enter valid email and password (minimum 6 characters)", "error");
    return;
  }

  let secondaryApp;
  try {
    // Create a temporary secondary Firebase app so we don't lose the current admin session
    secondaryApp = firebase.initializeApp(firebase.app().options, 'admin-create-' + Date.now());
    const secondaryAuth = secondaryApp.auth();
    const uc = await secondaryAuth.createUserWithEmailAndPassword(email, password);

    await db.collection('users').doc(uc.user.uid).set({
      email,
      role: 'admin',
      createdBy: currentUserEmail,
      createdAt: Date.now()
    });

    await secondaryAuth.signOut();
    addLog(`Created new Admin account: ${email}`, currentUserEmail, 'success');

    showSuccessModal(
      "New Admin Account Created!",
      `<strong>${_esc(email)}</strong> can now log in as Administrator with the password you just set.`
    );

    document.getElementById('newAdminEmail').value = '';
    document.getElementById('newAdminPassword').value = '';

  } catch (error) {
    showModal("Creation Failed", _esc(error.message) || "Something went wrong", "error");
  } finally {
    if (secondaryApp) secondaryApp.delete().catch(()=>{});
  }
}

// Fixed createGuidanceAccount
async function createGuidanceAccount() {
  const email = document.getElementById('newGuidanceEmail').value.trim().toLowerCase();
  const password = document.getElementById('newGuidancePassword').value.trim();

  if (!email || !password || password.length < 6) {
    showModal("Input Error", "Please enter valid email and password (minimum 6 characters)", "error");
    return;
  }

  let secondaryApp;
  try {
    secondaryApp = firebase.initializeApp(firebase.app().options, 'guidance-create-' + Date.now());
    const secondaryAuth = secondaryApp.auth();
    const uc = await secondaryAuth.createUserWithEmailAndPassword(email, password);

    await db.collection('users').doc(uc.user.uid).set({
      email,
      role: 'guidance',
      createdBy: currentUserEmail,
      createdAt: Date.now()
    });

    await secondaryAuth.signOut();
    addLog(`Created new Guidance account: ${email}`, currentUserEmail, 'success');

    showSuccessModal(
      "New Guidance Counselor Account Created!",
      `<strong>${_esc(email)}</strong> can now log in as Counselor with the password you just set.`
    );

    document.getElementById('newGuidanceEmail').value = '';
    document.getElementById('newGuidancePassword').value = '';

  } catch (error) {
    showModal("Creation Failed", _esc(error.message) || "Something went wrong", "error");
  } finally {
    if (secondaryApp) secondaryApp.delete().catch(()=>{});
  }
}

async function handleForgotPassword() {
  if (authBusy) return;
  forgotPasswordError = '';
  forgotPasswordSuccess = '';
  const email = (forgotPasswordEmail || '').trim().toLowerCase();
  if (!email) { forgotPasswordError = '❌ Please enter your email address.'; render(); return; }
  authBusy = 'reset'; render();
  try {
    await auth.sendPasswordResetEmail(email);
    forgotPasswordSuccess = 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.';
  } catch (error) {
    // do not reveal whether an address is registered
    if (error.code === 'auth/user-not-found') forgotPasswordSuccess = 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.';
    else forgotPasswordError = friendlyAuthError(error.code, error.message);
  } finally { authBusy = ''; render(); }
}

function logout() {
  // If guidance counselor is logging out, remove the push tag from this device
  if (currentRole === 'guidance') {
    unregisterAsCounselor();
  }
  localStorage.removeItem('qh_saved_role');
  localStorage.removeItem('qh_last_page');
  firestoreUnsubscribes.forEach(u => u());
  firestoreUnsubscribes = [];
  const wasAnonymous = isAnonymous;
  isAuthenticated = false;
  isAnonymous = false;
  currentRole = null;
  currentUserEmail = '';
  mobileDrawerOpen = false;
  postLimit = 25; consultLimit = 25; postingSearchQuery = '';
  showPostingForm = false; showConsultationForm = false; showFeedbackForm = false; showMeetScheduler = {};
  postingChatDraft = {}; consultationChatDraft = {}; guidanceMessageDraft = {};
  postings = [];
  consultationPostings = [];
  feedbackList = [];
  systemLogs = [];
  booting = false; loginError = ''; selectedRoleForLogin = null; _threatMemo.clear(); _attStore.clear();
  _seen = null; clearTimeout(_seenTimer); _seenTimer = null; clearInterval(_overdueTimer); _overdueTold.clear();
  staffFilter = { risk: 'all', needsReply: false, mine: false, grade: '', q: '' }; reportCache = {}; storageStats = null;
  postingAbout = 'me'; postingAboutWho = ''; postingContactPref = 'chat'; consultationGradeLevel = ''; studentStrand = ''; studentAge = 0; _profFor = null;
  closeSheet('qh-help'); closeSheet('qh-history');
  slots = []; announcements = []; replyTemplates = null; templatesEditing = null; slotDraft = { date: '', time: '' };
  render();
  if (!wasAnonymous) auth.signOut().catch(() => {});
}

    // ── FIRESTORE ──
    let dataLoaded = { postings:false, consultations:false, feedback:false };
    function loadDataFromFirestore() {
      firestoreUnsubscribes.forEach(u=>u());firestoreUnsubscribes=[];
      dataLoaded = { postings:false, consultations:false, feedback:false };

      // Postings: guidance/admin see all; students see only their own
      const postingsQuery = (currentRole==='guidance'||currentRole==='admin')
        ? db.collection('postings')
        : db.collection('postings').where('authorId','==',currentUserEmail);

      // Consultations: guidance/admin see all; students query by authorId
      const consultQuery = (currentRole==='guidance'||currentRole==='admin')
        ? db.collection('consultations')
        : db.collection('consultations').where('authorId','==',currentUserEmail);

      const isStaff = (currentRole==='guidance'||currentRole==='admin');
      const byTime = (a,b)=>(b.timestamp||0)-(a.timestamp||0);
      const onErr = (name)=>(e)=>{console.warn('[QHsafety] listener '+name+':',e && e.code);dataLoaded[name]=true;scheduleRender();};
      const clean = (s,kind)=>{const out=[];s.forEach(d=>{const x=cleanDoc(d.data(),kind);if(x)out.push(x);});return out.sort(byTime);};
      // Staff: newest 150 only (keeps memory + rendering small on weak devices)
      const pq = isStaff ? postingsQuery.orderBy('timestamp','desc').limit(150) : postingsQuery;
      const cq = isStaff ? consultQuery.orderBy('timestamp','desc').limit(150) : consultQuery;

      firestoreUnsubscribes.push(
        pq.onSnapshot(s=>{postings=clean(s,'posting');dataLoaded.postings=true;scheduleRender();},onErr('postings')),
        cq.onSnapshot(s=>{consultationPostings=clean(s,'consultation');dataLoaded.consultations=true;scheduleRender();},onErr('consultations'))
      );
      // Feedback: admin sees all, everyone else only their own
      const fbQuery = currentRole==='admin' ? db.collection('feedback').orderBy('timestamp','desc').limit(200)
                                            : db.collection('feedback').where('author','==',currentUserEmail);
      firestoreUnsubscribes.push(
        fbQuery.onSnapshot(s=>{feedbackList=s.docs.map(d=>d.data()).filter(Boolean).sort(byTime);dataLoaded.feedback=true;scheduleRender();},onErr('feedback'))
      );
      loadExtras();
      // Logs: only the admin Logs page uses them
      if (currentRole==='admin') {
        firestoreUnsubscribes.push(
          db.collection('logs').orderBy('timestamp','desc').limit(200).onSnapshot(s=>{systemLogs=s.docs.map(d=>d.data()).filter(Boolean).sort(byTime);scheduleRender();},onErr('logs'))
        );
      }
    }

    // ── POSTINGS ──
    // The post is saved and shown immediately using the local rules; the AI's second opinion
    // and any alert to the guidance office happen in the background.
    function addPosting() {
      const title = postingTitle.trim(), content = postingContent.trim();
      if (!title || !content) { postingError = 'Title and content are required'; render(); return; }
      const fullText = title + ' ' + content;
      const local = analyzeRisk(fullText);
      const cleanTitle = passLanguageGate(title, local), cleanContent = passLanguageGate(content, local);
      if (cleanTitle === null || cleanContent === null) { postingError = LANGUAGE_REFUSAL; render(); return; }

      if (postingContactPref !== 'chat') {
        if (!consultationGradeLevel) { postingError = tr('pNeedGrade'); render(); return; }
        const extra = { fromProblemForm: true };
        if (postingAbout === 'other') { extra.aboutOther = true; extra.aboutWho = postingAboutWho.trim().slice(0, 80); }
        consultationReason = title; consultationDescription = content; consultationPriority = postingPriority || 'Medium';
        consultationContactPref = postingContactPref; consultationMoodLevel = 0;   // 0 = the student was not asked
        postingTitle = ''; postingContent = ''; postingPriority = 'Medium'; showPostingForm = false; postingError = '';
        postingAbout = 'me'; postingAboutWho = ''; postingContactPref = 'chat';
        activeSidebarItem = 'Consultations';
        addConsultation(extra, tr('pSentConsult'));
        return;
      }
      const chosen = postingPriority || 'Medium';
      const authorLabel = isAnonymous ? 'Anonymous' : currentUserEmail;
      const newPosting = {
        id: newDocId(),
        title: cleanTitle,
        content: cleanContent,
        priority: priorityFor(chosen, local),
        aiScore: local.score,
        riskLevel: local.level,
        flagged: !!local.flagged,
        reasons: local.reasons,
        author: authorLabel,
        authorId: currentUserEmail,
        isAnonymous: isAnonymous,
        timestamp: Date.now()
      };
      if (consultationGradeLevel) newPosting.gradeLevel = consultationGradeLevel;
      if (studentStrand && isSHS(consultationGradeLevel)) newPosting.strand = studentStrand;
      if (studentAge) newPosting.age = studentAge;
      const aboutOther = postingAbout === 'other';
      if (aboutOther) { newPosting.aboutOther = true; newPosting.aboutWho = postingAboutWho.trim().slice(0, 80); }
      const write = db.collection('postings').doc(String(newPosting.id)).set(newPosting);

      // Clear the form straight away — the live listener already shows the new post
      postingTitle = ''; postingContent = ''; postingPriority = 'Medium'; showPostingForm = false; postingError = '';
      postingAbout = 'me'; postingAboutWho = '';
      render();
      toast((appLang === 'tl' ? 'Nai-post na' : 'Posted') + (isAfterHours() ? ' — ' + tr('afterHours').toLowerCase() : ''));
      maybeShowSupport(local, aboutOther);

      write.then(() => refineRiskInBackground('postings', newPosting, fullText, local, 'Posting', cleanTitle, cleanContent, chosen))
        .catch(e => {
          // Saving failed: give the student their words back
          postingTitle = title; postingContent = content; postingPriority = chosen; showPostingForm = true;
          postingError = 'Could not post: ' + _esc((e && e.message) || 'check your connection and try again');
          activeSidebarItem = 'Postings';
          render();
        });
    }

async function deletePosting(id) {
  const ok = await confirmModal("Delete posting", "Permanently delete this posting? This cannot be undone.", "warning");
  if (!ok) return;
  try {
    await db.collection('postings').doc(String(id)).delete();
    addLog('Post deleted', currentUserEmail, 'warning');
    toast('Posting deleted');
  } catch(e) {
    showModal("Error", "Failed to delete posting: " + _esc(e.message), "error");
  }
}

function getPriorityColor(p) {
  return p === 'High' ? '#ef5350' : p === 'Medium' ? '#ff9800' : '#66bb6a';
}

// ── PERMISSION HELPER ──
function canDelete(item, type) {
  if (!item || !currentRole) return false;
  if (currentRole === 'admin') return true;
  if (currentRole === 'guidance') return true;
  if (currentRole === 'student') {
    return item.authorId === currentUserEmail;
  }
  return false;
}

// ── ONESIGNAL: Update notification button/indicator UI state ──
function updateNotifUI() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal) {
    try {
      const enabled = await OneSignal.Notifications.permission;

      // Mobile topbar bell dot
      const dot = document.getElementById('mob-notif-dot');
      if (dot) dot.style.display = enabled ? 'block' : 'none';
      // Desktop sidebar bell dot
      const deskDot = document.getElementById('desk-notif-dot');
      if (deskDot) deskDot.style.display = enabled ? 'block' : 'none';

      // Settings page status label
      const label = document.getElementById('settings-notif-label');
      const icon  = document.getElementById('settings-notif-icon');
      const btn   = document.getElementById('settings-notif-btn');
      if (label) {
        if (enabled) {
          label.textContent = 'Push notifications are enabled on this device.';
          label.style.color = '#388e3c';
          if (icon) icon.textContent = '✅';
          if (btn) {
            btn.textContent = 'Notifications enabled';
            btn.style.background = '#66bb6a';
            btn.style.color = '#fff';
          }
        } else {
          label.textContent = 'Push notifications are not enabled yet.';
          label.style.color = '';
          if (icon) icon.textContent = '🔕';
          if (btn) {
            btn.innerHTML = iconSvg('bell-ring', ' style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:6px"') + 'Enable Push Notifications';
            btn.style.background = '#ffee58';
            btn.style.color = '#2c3e50';
          }
        }
      }
    } catch(e) {
      // OneSignal not ready yet — silence
    }
  });
}

// ── ONESIGNAL: Manual push enable button ──
async function enablePushNotifications() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal) {
    try {
      const permission = await OneSignal.Notifications.permission;
      const tag = currentRole === 'guidance' ? 'guidance' : 'student';
      if (permission) {
        await OneSignal.User.addTag("user_role", tag);
        showModal('✅ Already Enabled', `Push notifications are active. You are subscribed as <strong>${tag}</strong>.`, 'success');
        updateNotifUI();
        return;
      }
      await OneSignal.Notifications.requestPermission();
      if (await OneSignal.Notifications.permission) {
        await OneSignal.User.addTag("user_role", tag);
        showModal('🔔 Notifications Enabled!', `You will now receive push notifications as <strong>${tag}</strong>.`, 'success');
      } else {
        showModal('Blocked', 'Notifications are blocked. Go to your browser\'s Site Settings → Notifications → Allow for this site, then try again.', 'error');
      }
      updateNotifUI();
    } catch(e) {
      showModal('Error', 'Could not enable notifications: ' + (e.message || e), 'error');
    }
  });
}

// ── ONESIGNAL: Register this device as the Guidance Counselor ──
// Called automatically after a successful guidance login.
// Tags this device with user_role=guidance so push alerts are
// delivered ONLY to the counselor — even when offline or app is closed.
function registerAsCounselor() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal) {
    try {
      // Request push permission if not yet granted
      const permission = await OneSignal.Notifications.permission;
      if (!permission) {
        await OneSignal.Notifications.requestPermission();
      }
      // Tag this device as the guidance counselor
      await OneSignal.User.addTag("user_role", "guidance");
      console.log("[QHsafety] Device registered as Guidance Counselor for push alerts.");
    } catch (e) {
      console.warn("[QHsafety] Could not register counselor push tag:", e);
    }
  });
}

// ── ONESIGNAL: Remove counselor tag on logout ──
function unregisterAsCounselor() {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.User.removeTag("user_role");
    } catch (e) {
      console.warn("[QHsafety] Could not remove counselor push tag:", e);
    }
  });
}

// ── ONESIGNAL: Broadcast announcement to all students (through our own /api/notify) ──
async function sendAnnouncementPush(title, message) {
  // Route through our own backend — no Cloudflare/corsproxy needed
  const res = await fetch("/api/notify", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ title, message, target: "broadcast" })
  });
  return await res.json().catch(() => ({}));
}

async function getAnnouncementStats(notifId) {
  // Stats fetched from backend to avoid CORS restrictions
  const res = await fetch(`/api/notify-stats?id=${encodeURIComponent(notifId)}`, { headers: await authHeaders() });
  if (!res.ok) return {};
  return await res.json();
}

let announcementTitle = '', announcementMessage = '';

async function handleSendAnnouncement() {
  if (announcementBusy) return;
  const title = announcementTitle.trim(), message = announcementMessage.trim();
  if (!title || !message) { showModal('Missing fields', 'Please enter both a title and message.', 'error'); return; }
  if (containsProfanity(title + ' ' + message)) { showModal('Please rephrase', LANGUAGE_REFUSAL, 'error'); return; }
  const ok = await confirmModal('Send to all students?', 'Every student who enabled notifications will receive:<br><br><strong>' + _esc(title) + '</strong><br>' + _esc(message), 'info', 'Send');
  if (!ok) return;

  announcementBusy = true; render();
  const statusEl = () => document.getElementById('announcement-status');
  const resultEl = () => document.getElementById('announcement-result');
  const say = (text, color) => { const el = statusEl(); if (el) { el.style.display = 'block'; el.textContent = text; el.style.color = color; } };
  const r0 = resultEl(); if (r0) r0.style.display = 'none';
  say('Sending…', '#1565c0');
  try {
    const data = await sendAnnouncementPush(title, message);
    if (!data || !data.id) throw new Error(JSON.stringify((data && (data.errors || data.error)) || data || 'No response'));
    const delivered = Number(data.recipients || data.successful || data.received || 0);
    say('Announcement sent', '#2e7d32');
    const r = resultEl();
    if (r) { r.style.display = 'block'; r.innerHTML = `<span style="font-size:28px;font-weight:900;color:${delivered>0?'#388e3c':'#f57c00'}">${delivered}</span><br><span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Recipients</span>`; }
    addLog(`📢 Announcement sent to ${delivered} student(s): "${title}"`, currentUserEmail, 'info');
    const annId = newDocId();   // keep a copy on the board so students can read it later
    db.collection('announcements').doc(String(annId)).set({ id: annId, title, message, by: currentUserEmail, timestamp: Date.now() }).catch(() => {});
    announcementTitle = ''; announcementMessage = '';
  } catch(e) {
    say('Failed to send announcement.', '#c62828');
    showModal('Send failed', 'Could not broadcast the announcement. Check your connection and try again.<br><small>' + _esc(e.message) + '</small>', 'error');
    console.error('[QHsafety] Announcement broadcast error:', e);
  } finally {
    announcementBusy = false; render();
  }
}

/** * 🚨 THE MESSENGER FUNCTION 
 * Sends a push notification ONLY to devices tagged as guidance counselor.
 * Delivered via OneSignal → OS push service (FCM/APNs), so it arrives
 * even when the counselor's browser/tab is closed or device is locked.
 */
async function sendOneSignalPush(title, message, postId, postType, riskLevel, riskScore, reasons) {
  try {
    // Build deep-link URL so counselor lands directly on the post
    const deepUrl = postId
      ? `${window.location.origin}?deeplink=${postType || 'posting'}&id=${postId}&risk=${riskLevel || 'High'}&score=${riskScore || 0}`
      : window.location.href;
    const response = await fetch("/api/notify", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ title, message, url: deepUrl, reasons: reasons || [] })
    });
    return await response.json().catch(() => ({}));
  } catch (e) {
    console.error("OneSignal Error:", e);
  }
}
  
    // ── CONSULTATIONS ──
    function addConsultation(extra, sentMsg) {
      const reason = consultationReason.trim(), details = consultationDescription.trim();
      if (!reason || !details) { consultationError = 'Reason and details are required'; render(); return; }
      if (!consultationGradeLevel) { consultationError = 'Please select your grade level'; render(); return; }
      const fullText = reason + ' ' + details;
      const local = analyzeRisk(fullText);
      const cleanReason = passLanguageGate(reason, local), cleanDesc = passLanguageGate(details, local);
      if (cleanReason === null || cleanDesc === null) { consultationError = LANGUAGE_REFUSAL; render(); return; }

      const chosen = consultationPriority || 'Medium';
      const authorLabel = isAnonymous ? 'Anonymous' : currentUserEmail;
      const saved = { grade: consultationGradeLevel, pref: consultationContactPref, mood: consultationMoodLevel };
      const newConsult = {
        id: newDocId(), reason: cleanReason, description: cleanDesc, priority: priorityFor(chosen, local),
        gradeLevel: saved.grade, contactPref: saved.pref, studentMood: saved.mood,
        author: authorLabel, authorId: currentUserEmail, isAnonymous: isAnonymous, status: 'Pending',
        riskLevel: local.level, aiScore: local.score, flagged: !!local.flagged, reasons: local.reasons,
        timestamp: Date.now(), messages: []
      };
      if (studentStrand && isSHS(consultationGradeLevel)) newConsult.strand = studentStrand;
      if (studentAge) newConsult.age = studentAge;
      if (extra && typeof extra === 'object') Object.assign(newConsult, extra);
      const write = db.collection('consultations').doc(String(newConsult.id)).set(newConsult);

      consultationReason = ''; consultationDescription = ''; consultationPriority = 'Medium';
      consultationGradeLevel = ''; consultationContactPref = 'chat'; consultationMoodLevel = 3; showConsultationForm = false; consultationError = '';
      render();
      toast((sentMsg || (appLang === 'tl' ? 'Naipadala ang kahilingan' : 'Request sent')) + (isAfterHours() ? ' — ' + tr('afterHours').toLowerCase() : ''));
      maybeShowSupport(local, !!newConsult.aboutOther);

      write.then(() => {
        addLog('Consultation submitted', authorLabel, 'info');
        return refineRiskInBackground('consultations', newConsult, fullText, local, 'Consultation', cleanReason, cleanDesc, chosen);
      }).catch(e => {
        consultationReason = reason; consultationDescription = details; consultationPriority = chosen;
        consultationGradeLevel = saved.grade; consultationContactPref = saved.pref; consultationMoodLevel = saved.mood || 3;
        showConsultationForm = true;
        consultationError = 'Could not submit: ' + _esc((e && e.message) || 'check your connection and try again');
        activeSidebarItem = 'Consultations';
        render();
      });
    }

    async function deleteConsultationPosting(id){
      const ok = await confirmModal("Cancel request", "Cancel this consultation request? This cannot be undone.", "warning", "Cancel request");
      if (!ok) return;
      try{await db.collection('consultations').doc(String(id)).delete();addLog('Consultation cancelled',currentUserEmail,'warning');toast('Request cancelled');}
      catch(e){showModal("Error","Could not cancel request: "+_esc(e.message),"error");}
    }
    async function updateConsultationStatus(id){try{await db.collection('consultations').doc(String(id)).update({status:'Done',appointmentStatus:'Done',appointmentStatusUpdatedAt:Date.now()});addLog('Consultation marked as Done',currentUserEmail,'success');toast('Marked as resolved','success');}catch(e){console.error(e);addLog('Failed to mark as Done',currentUserEmail,'error');toast('Could not update — try again','error');}}

  // ── CONSULTATION: SCHEDULE MEET OR PHONE CALL ──
const arrayUnion = (x) => firebase.firestore.FieldValue.arrayUnion(x);   // adds a chat message atomically, in one round trip
const nowTime = () => new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});

async function scheduleConsultMeet(consultId) {
  const d = consultMeetDraft;
  if (!d.date || !d.time) { showModal('Missing info', 'Please select both a date and time.', 'error'); return; }
  const isoStr = d.date + 'T' + d.time;
  if (isNaN(new Date(isoStr).getTime())) { showModal('Invalid date', 'Please pick a valid date and time.', 'error'); return; }

  const consultData = consultationPostings.find(c => String(c.id) === String(consultId));
  if (!consultData) { showModal('Not found', 'This consultation no longer exists.', 'error'); return; }
  const isPhone = (consultData.contactPref === 'phone');
  const rawLink = (d.link || '').trim();
  const link = isPhone ? rawLink.replace(/[^\d+\-() ]/g, '').slice(0, 24) : safeHttpUrl(rawLink);
  if (rawLink && !link) { showModal('Check the link', 'That does not look like a valid meeting link.', 'error'); return; }

  const meetData = {
    meetDate: d.date,
    meetTime: d.time,
    meetDateTime: isoStr,
    meetLink: link,
    meetNotes: (d.notes || '').trim().slice(0, 500),
    meetScheduledBy: currentUserEmail,
    meetScheduledAt: Date.now(),
    status: 'Pending'
  };
  const dateLabel = new Date(isoStr).toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  let msgText = '';
  if (isPhone) {
    msgText = '📱 <strong>Phone Call Scheduled!</strong><br>Date & Time: ' + _esc(dateLabel)
      + (link ? '<br>📞 <a href="tel:' + link.replace(/[^\d+]/g,'') + '">' + _esc(link) + '</a> (tap to call)' : '')
      + (meetData.meetNotes ? '<br>📝 ' + _esc(meetData.meetNotes) : '');
  } else {
    msgText = '📅 <strong>Meeting Scheduled!</strong><br>Date & Time: ' + _esc(dateLabel)
      + (link ? '<br>🔗 <a href="' + _esc(link) + '">Join Google Meet</a>' : '')
      + (meetData.meetNotes ? '<br>📝 ' + _esc(meetData.meetNotes) : '');
  }
  const sysMsg = { sender: currentUserEmail, role: 'guidance', isSystem: true, text: msgText, time: nowTime(), ts: Date.now() };
  try {
    await db.collection('consultations').doc(String(consultId)).update({ ...meetData, chatMessages: arrayUnion(sysMsg) });
    showMeetScheduler = {};
    consultMeetDraft = {date:'',time:'',link:'',notes:''};
    addLog((isPhone?'Phone call':'Meet')+' scheduled for consultation #'+consultId, currentUserEmail, 'success');
    render();
    toast(isPhone ? 'Phone call scheduled — the student can see it in the chat' : 'Meeting scheduled — the student can see it in the chat', 'success');
  } catch(e) { showModal('Error', 'Failed to schedule: ' + _esc(e.message), 'error'); }
}

async function cancelConsultMeet(consultId) {
  const ok = await confirmModal('Cancel meeting', 'Remove the scheduled meeting from this consultation?', 'warning', 'Cancel meeting');
  if (!ok) return;
  const booked = (consultationPostings.find(c => String(c.id) === String(consultId)) || {}).slotId;
  try {
    const del = firebase.firestore.FieldValue.delete();
    await db.collection('consultations').doc(String(consultId)).update({
      meetDate: del, meetTime: del, meetDateTime: del, meetLink: del, meetNotes: del, meetScheduledBy: del, meetScheduledAt: del, slotId: del
    });
    if (booked) db.collection('slots').doc(String(booked)).update({ takenBy: '', consultId: '' }).catch(() => {});   // the time becomes available again
    addLog('Meet cancelled for consultation #'+consultId, currentUserEmail, 'warning');
    toast('Meeting cancelled');
  } catch(e) { showModal('Error', 'Failed to cancel meeting: ' + _esc(e.message), 'error'); }
}

// ── CONSULTATION: APPOINTMENT STATUS (Pending → Confirmed → Done) ──
async function updateAppointmentStatus(consultId, newStatus) {
  if (!['Pending','Confirmed','Done'].includes(newStatus)) return;
  try {
    const sysMsg = {
      sender: currentUserEmail, role: currentRole, isSystem: true,
      text: `📋 <strong>Appointment ${newStatus}</strong> — The guidance counselor has ${newStatus==='Confirmed'?'confirmed your appointment.':newStatus==='Done'?'marked this session as completed.':'updated the appointment status.'}`,
      time: nowTime(), ts: Date.now()
    };
    await db.collection('consultations').doc(String(consultId)).update({ appointmentStatus: newStatus, appointmentStatusUpdatedAt: Date.now(), chatMessages: arrayUnion(sysMsg) });
    addLog(`Appointment status → ${newStatus} for #${consultId}`, currentUserEmail, 'info');
  } catch(e) { showModal('Error', 'Failed to update status: ' + _esc(e.message), 'error'); }
}

// ── CONSULTATION: FILE ATTACHMENT IN CHAT ──
const ATTACH_TYPES = /^data:(image\/(png|jpe?g|gif|webp)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,/;
async function sendConsultAttachment(consultId) {
  const input = document.getElementById('attachInput_'+consultId);
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const done = () => { input.value = ''; };
  const isPhoto = /^image\/(png|jpe?g|webp)$/.test(file.type);

  if (isPhoto ? file.size > ATTACH_IMAGE_INPUT_MAX : file.size > ATTACH_DOC_MAX_BYTES) {
    showModal('File too large', isPhoto ? 'That photo is over 12 MB. Please choose a smaller one.' : `Documents and GIFs must be under ${Math.round(ATTACH_DOC_MAX_BYTES/1024)} KB (yours is ${(file.size/1024).toFixed(0)} KB). Photos are shrunk automatically, so a screenshot of the page works well.`, 'error');
    return done();
  }
  const consult = consultationPostings.find(c => String(c.id) === String(consultId));
  const existing = (consult && consult.chatMessages) || [];
  if (existing.filter(m => m.isAttachment).length >= ATTACH_MAX_PER_CONSULT) {
    showModal('Attachment limit reached', `Maximum ${ATTACH_MAX_PER_CONSULT} attachments allowed per consultation to keep storage usage low.`, 'warning');
    return done();
  }
  if (currentRole === 'student') {
    let totalAttach = 0;
    consultationPostings.forEach(c => { totalAttach += (c.chatMessages || []).filter(m => m.isAttachment && (m.sender === currentUserEmail || m.sender === 'Anonymous')).length; });
    if (totalAttach >= ATTACH_MAX_TOTAL_PER_USER) {
      showModal('Total attachment limit reached', `You have reached the maximum of ${ATTACH_MAX_TOTAL_PER_USER} attachments across all your consultations.`, 'warning');
      return done();
    }
  }
  try {
    toast('Uploading…');
    const base64 = isPhoto ? await compressImage(file) : await readAsDataURL(file);
    if (!ATTACH_TYPES.test(base64)) { showModal('File type not supported', 'Please attach an image (PNG, JPG, GIF, WebP), a PDF or a Word document.', 'error'); return done(); }
    const bytes = Math.round(base64.length * 0.75);
    // a Firestore document holds at most 1 MB in total, including every earlier message
    const used = JSON.stringify(consult || {}).length;
    if (used + base64.length > 950 * 1024) { showModal('This chat is full', 'This consultation cannot hold another file. Please open a new consultation request for further attachments.', 'warning'); return done(); }
    const authorLabel = isAnonymous ? 'Anonymous' : currentUserEmail;
    const attachMsg = {
      sender: authorLabel, role: currentRole, isAttachment: true,
      fileName: file.name.slice(0, 120), fileType: isPhoto ? 'image/jpeg' : file.type, fileSize: bytes,
      fileData: base64, isImage: file.type.startsWith('image/'),
      time: nowTime(), ts: Date.now()
    };
    await db.collection('consultations').doc(String(consultId)).update({ chatMessages: arrayUnion(attachMsg) });
    addLog(`Attachment sent in consultation #${consultId}`, authorLabel, 'info');
  } catch (err) { showModal('Error', 'Failed to send attachment: ' + _esc((err && err.message) || 'unknown error'), 'error'); }
  done();
}

// ── CONSULTATION: SESSION RATING (after Done) ──
async function submitSessionRating(consultId) {
  const rating = consultSessionRating[consultId];
  const feedback = (consultSessionFeedback[consultId] || '').trim();
  if (!rating) { showModal('Rate session', 'Please select a star rating before submitting.', 'warning'); return; }
  if (feedback && passLanguageGate(feedback) === null) { showModal('Please rephrase', LANGUAGE_REFUSAL, 'error'); return; }
  try {
    await db.collection('consultations').doc(String(consultId)).update({
      sessionRating: rating, sessionFeedback: feedback.slice(0, 500), sessionRatedAt: Date.now(), sessionRatedBy: currentUserEmail
    });
    addLog(`Session rated ${rating}/5 for consultation #${consultId}`, currentUserEmail, 'info');
    consultSessionRating[consultId] = 0;
    consultSessionFeedback[consultId] = '';
    toast('Thank you — your rating was sent', 'success');
  } catch(e) { showModal('Error', _esc(e.message), 'error'); }
}

// ── CONSULTATION: MEETING REMINDER (email + in-app) ──
async function sendMeetReminder(consultId) {
  const consult = consultationPostings.find(c => String(c.id) === String(consultId));
  if (!consult || !consult.meetDateTime) return;
  try {
    const dateLabel = new Date(consult.meetDateTime).toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    const sysMsg = {
      sender: currentUserEmail, role: 'guidance', isSystem: true,
      text: `🔔 <strong>Reminder:</strong> Your consultation meeting is scheduled for <strong>${_esc(dateLabel)}</strong>. Please be ready on time.`,
      time: nowTime(), ts: Date.now()
    };
    await db.collection('consultations').doc(String(consultId)).update({ chatMessages: arrayUnion(sysMsg), reminderSentAt: Date.now() });
    toast('Reminder sent to the student', 'success');
    addLog(`Reminder sent for consultation #${consultId}`, currentUserEmail, 'success');
    // Email reminder (not awaited by the UI)
    const studentEmail = consult.authorId || '';
    if (studentEmail && !studentEmail.startsWith('anon_') && studentEmail !== 'Anonymous') {
      notifyStudentOfConsultationReply(studentEmail, 'Meeting Reminder',
        `Reminder: Your consultation meeting is on ${dateLabel}. Please be ready and check the app for the Google Meet link.`);
    }
  } catch(e) { showModal('Error', _esc(e.message), 'error'); }
}

// ── CONSULTATION: UPDATE MOOD ──
async function saveConsultMood(consultId, mood) {
  try {
    await db.collection('consultations').doc(String(consultId)).update({ studentMood: mood, moodUpdatedAt: Date.now() });
  } catch(e) { console.warn('Mood save failed:', e); toast('Could not save — try again', 'error'); }
}

// ── CONSULTATION: MARK URGENT ──
async function toggleConsultUrgent(consultId, currentVal) {
  try {
    await db.collection('consultations').doc(String(consultId)).update({ urgent: !currentVal });
    addLog('Consultation urgency toggled', currentUserEmail, 'warning');
  } catch(e) { showModal('Error', _esc(e.message), 'error'); }
}

// ── CONSULTATION: ADD PRIVATE GUIDANCE NOTE ──
async function saveGuidanceNote(consultId) {
  const noteEl = document.getElementById('guidance-note-'+consultId);
  if (!noteEl) return;
  const note = noteEl.value.trim();
  try {
    await db.collection('consultations').doc(String(consultId)).update({ guidanceNote: note, noteUpdatedAt: Date.now() });
    toast('Private note saved', 'success');
  } catch(e) { showModal('Error', _esc(e.message), 'error'); }
}

// ── CONSULTATION: REFERRAL ──
async function saveReferral(consultId) {
  const el = document.getElementById('referral-'+consultId);
  if (!el) return;
  const val = el.value.trim();
  try {
    await db.collection('consultations').doc(String(consultId)).update({ referredTo: val, referredAt: Date.now() });
    toast(val ? 'Referral saved' : 'Referral cleared', 'success');
    addLog('Student referred to '+val, currentUserEmail, 'info');
  } catch(e) { showModal('Error', _esc(e.message), 'error'); }
}

  // ── GUIDANCE MESSAGES ──
let guidanceMessageDraft = {}; // keyed by postingId

async function sendGuidanceMessage(postingId) {
  const msg = (guidanceMessageDraft[postingId] || '').trim();
  if (!msg) { showModal('Empty message', 'Please type a message before sending.', 'warning'); return; }
  if (containsProfanity(msg)) { showModal('Please rephrase', LANGUAGE_REFUSAL, 'error'); return; }
  const post = postings.find(p => String(p.id) === String(postingId)) || {};
  try {
    await db.collection('postings').doc(String(postingId)).update({
      guidanceMessage: msg,
      guidanceMessageTs: Date.now(),
      ...(post.firstReplyAt ? {} : { firstReplyAt: Date.now() }),
      guidanceMessageAt: new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})
    });
    addLog(`Guidance message sent on post #${postingId}`, currentUserEmail, 'info');
    guidanceMessageDraft[postingId] = '';
    const box = document.getElementById('gmsg_' + postingId); if (box) box.value = '';
    render();
    toast('Message sent to the student', 'success');
    // 📧 Email the student (in the background)
    notifyStudentOfGuidanceReply(post.authorId || post.author || '', post.title || 'your posting', msg);
  } catch(e) { showModal('Error', 'Failed to send message: ' + _esc(e.message), 'error'); }
}

// ── POSTING CHAT (student replies) ──
async function sendPostingChat(postingId) {
  const typed = (postingChatDraft[postingId] || '').trim();
  if (!typed) return;
  const msg = passLanguageGate(typed);
  if (msg === null) { showModal('Please rephrase', LANGUAGE_REFUSAL, 'error'); return; }
  const authorLabel = isAnonymous ? 'Anonymous' : currentUserEmail;
  const chatMsg = { sender: authorLabel, role: currentRole, text: msg, time: nowTime(), ts: Date.now() };
  // clear the box first so it feels instant; the live listener shows the message right away
  postingChatDraft[postingId] = '';
  const inp = document.getElementById('postChat_'+postingId);
  if (inp) inp.value = '';
  try {
    const postItem = postings.find(p => String(p.id) === String(postingId)) || {};
    await db.collection('postings').doc(String(postingId)).update({ chatMessages: arrayUnion(chatMsg), ...(currentRole === 'guidance' && !postItem.firstReplyAt ? { firstReplyAt: Date.now() } : {}) });
    escalateFromChat('postings', postingId, typed);
  } catch(e) {
    postingChatDraft[postingId] = typed; if (inp && !inp.value) inp.value = typed;
    showModal('Error','Failed to send: '+_esc(e.message),'error');
  }
}

// ── CONSULTATION CHAT (student + guidance) ──
async function sendConsultationChat(consultId) {
  const typed = (consultationChatDraft[consultId] || '').trim();
  if (!typed) return;
  const msg = passLanguageGate(typed);
  if (msg === null) { showModal('Please rephrase', LANGUAGE_REFUSAL, 'error'); return; }
  const authorLabel = isAnonymous ? 'Anonymous' : currentUserEmail;
  const chatMsg = { sender: authorLabel, role: currentRole, text: msg, time: nowTime(), ts: Date.now() };
  consultationChatDraft[consultId] = '';
  const inp = document.getElementById('consultChat_'+consultId);
  if (inp) inp.value = '';
  try {
    const consultItem = consultationPostings.find(c => String(c.id) === String(consultId)) || {};
    await db.collection('consultations').doc(String(consultId)).update({ chatMessages: arrayUnion(chatMsg), ...(currentRole === 'guidance' ? { guidanceTypingAt: 0, ...(consultItem.firstReplyAt ? {} : { firstReplyAt: Date.now() }) } : {}) });
    escalateFromChat('consultations', consultId, typed);
    // 📧 If guidance replied, notify the student (in the background)
    if (currentRole === 'guidance') {
      const consultData = consultationPostings.find(c => String(c.id) === String(consultId)) || {};
      notifyStudentOfConsultationReply(consultData.authorId || consultData.author || '', consultData.reason || 'your consultation', msg);
    }
  } catch(e) {
    consultationChatDraft[consultId] = typed; if (inp && !inp.value) inp.value = typed;
    showModal('Error','Failed to send: '+_esc(e.message),'error');
  }
}

// ── BULK DELETE ──
async function deleteWholeCollection(name, label) {
  const input = await promptModal(
    'Delete all ' + label,
    'This will <strong>permanently delete ALL ' + label + '</strong>.<br><br>Type <strong>DELETE</strong> to confirm.',
    'warning'
  );
  if (input !== 'DELETE') {
    if (input !== null) showModal('Cancelled', 'Input did not match. Nothing was deleted.', 'info');
    return;
  }
  try {
    const snapshot = await db.collection(name).get();
    if (snapshot.empty) { showModal('Nothing to delete', 'There are no ' + label + '.', 'info'); return; }
    // Firestore allows at most 500 writes per batch
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    addLog(`All ${label} deleted (${snapshot.size} items)`, currentUserEmail, 'warning');
    showModal('Done', `Deleted ${snapshot.size} ${label}.`, 'success');
  } catch (err) { showModal('Delete failed', _esc(err.message), 'error'); }
}
function deleteAllPostings()      { return deleteWholeCollection('postings', 'postings'); }
function deleteAllConsultations() { return deleteWholeCollection('consultations', 'consultations'); }
function deleteAllFeedback()      { return deleteWholeCollection('feedback', 'feedback'); }
  

// ── FIREBASE STORAGE MONITOR ──
// Firebase Free Tier limits:
//   Firestore: 1 GiB storage, 50K reads/day, 20K writes/day, 20K deletes/day
// We estimate usage by summing serialized JSON sizes of all documents.
let storageStats = null;
let storageLoading = false;

async function scanFirebaseStorage() {
  storageLoading = true;
  storageStats = null;
  render();
  try {
    const FREE_TIER_LIMIT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB
    const collections = [
      { name: 'postings',      label: 'Postings',      icon: 'megaphone',      color: '#90caf9' },
      { name: 'consultations', label: 'Consultations', icon: 'users',          color: '#a5d6a7' },
      { name: 'feedback',      label: 'Feedback',      icon: 'message-circle', color: '#ffe082' },
      { name: 'counselors',    label: 'Counselors',    icon: 'shield',         color: '#ce93d8' },
      { name: 'logs',          label: 'Logs',          icon: 'file-text',      color: '#b0bec5' },
      { name: 'users',         label: 'Users',         icon: 'users',          color: '#80cbc4' },
    ];
    let totalBytes = 0;
    const results = [];
    for (const col of collections) {
      try {
        const snap = await db.collection(col.name).get();
        let colBytes = 0;
        let attachmentBytes = 0;
        let attachmentCount = 0;
        let docCount = snap.size;
        snap.forEach(doc => {
          const raw = JSON.stringify(doc.data());
          colBytes += raw.length;
          // Count base64 attachments separately (big contributors)
          const msgs = doc.data().chatMessages || [];
          msgs.forEach(m => {
            if (m.isAttachment && m.fileData) {
              const ab = Math.round(m.fileData.length * 0.75); // base64 to bytes
              attachmentBytes += ab;
              attachmentCount++;
            }
          });
        });
        totalBytes += colBytes;
        results.push({
          ...col,
          docCount,
          bytes: colBytes,
          attachmentBytes,
          attachmentCount,
          pct: FREE_TIER_LIMIT_BYTES > 0 ? (colBytes / FREE_TIER_LIMIT_BYTES) * 100 : 0
        });
      } catch(colErr) {
        // Skip collections we don't have permission to read
        console.warn('[QHsafety] Skipped collection "' + col.name + '" (no read permission):', colErr.message);
        results.push({ ...col, docCount: 0, bytes: 0, attachmentBytes: 0, attachmentCount: 0, pct: 0, skipped: true });
      }
    }
    // Sort largest first
    results.sort((a, b) => b.bytes - a.bytes);
    const totalPct = (totalBytes / FREE_TIER_LIMIT_BYTES) * 100;
    const level = totalPct >= 80 ? 'critical' : totalPct >= 50 ? 'warning' : totalPct >= 25 ? 'caution' : 'safe';
    storageStats = { results, totalBytes, totalPct, FREE_TIER_LIMIT_BYTES, level, scannedAt: Date.now() };
    addLog('Storage scan completed — ' + formatBytes(totalBytes) + ' used (' + totalPct.toFixed(2) + '%)', currentUserEmail, totalPct >= 80 ? 'warning' : 'info');
  } catch(e) {
    storageStats = { error: e.message };
  }
  storageLoading = false;
  render();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(3) + ' GB';
}

    // ── FEEDBACK ──
    async function addFeedback() {
      const typed = feedbackMessage.trim();
      if(!typed){feedbackError='Please enter feedback message';render();return;}
      const message = passLanguageGate(typed);
      if(message===null){feedbackError=LANGUAGE_REFUSAL;render();return;}
      const rating = Math.max(1, Math.min(5, Number(feedbackRating) || 5));
      const newFeedback={id:newDocId(),author:currentUserEmail,authorRole:currentRole==='guidance'?'Guidance Office':currentRole==='student'?'Student':'Admin',rating,message,date:new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),time:nowTime(),timestamp:Date.now()};
      const write = db.collection('feedback').add(newFeedback);
      feedbackMessage='';feedbackRating=5;showFeedbackForm=false;feedbackError='';render();
      toast(appLang==='tl'?'Salamat sa feedback':'Thanks for the feedback','success');
      write.then(()=>addLog('Feedback submitted',currentUserEmail,'info'))
        .catch(e=>{feedbackMessage=typed;feedbackRating=rating;showFeedbackForm=true;feedbackError='Could not submit: '+_esc((e&&e.message)||'try again');render();});
    }

  // Delete consultation (for Guidance & Admin)
async function deleteConsultation(id) {
  const ok = await confirmModal("Delete consultation", "Permanently delete this consultation and its chat? This cannot be undone.", "warning");
  if (!ok) return;
  try {
    await db.collection('consultations').doc(String(id)).delete();
    addLog(`Consultation deleted by ${currentRole}`, currentUserEmail, 'warning');
    toast('Consultation deleted');
  } catch (e) {
    showModal("Error", "Failed to delete consultation: " + _esc(e.message), "error");
  }
}
  
  
  

// ── CONSULTATION CHAT MESSAGE RENDERER ──
// System messages (meeting scheduled, reminders) carry a little formatting. Anyone who can write to a
// consultation could forge one, so only <strong>, <br> and plain https/tel links survive.
function safeSystemHtml(html) {
  let s = _esc(html);
  s = s.replace(/&lt;(\/?)strong&gt;/g, '<$1strong>').replace(/&lt;br\s*\/?&gt;/g, '<br>');
  s = s.replace(/&lt;a href=&quot;((?:https?:\/\/|tel:)[^&\s<>]*(?:&amp;[^&\s<>]*)*)&quot;(?:(?!&gt;).)*&gt;((?:(?!&lt;).)*)&lt;\/a&gt;/g,
    (m, url, text) => '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#1565c0;text-decoration:underline;font-weight:700">' + text + '</a>');
  return s;
}
function renderConsultChatMsg(m, c) {
  const primaryColor = config.primary_action_color, textColor = config.text_color;
  const sender = String(m.sender || '');
  const isMine = sender === currentUserEmail || (sender === 'Anonymous' && isAnonymous);
  if (m.isSystem) {
    return '<div style="width:100%;padding:10px 14px;border-radius:12px;font-size:12px;line-height:1.6;background:#e8f5e9;color:#2e7d32;border:1px solid #66bb6a33;text-align:center">' +
      safeSystemHtml(m.text) + '<div style="font-size:10px;margin-top:4px;opacity:0.6">' + _esc(m.time||'') + '</div></div>';
  }
  const fromGuidance = m.role === 'guidance';
  const bg = fromGuidance ? '#1565c0' : isMine ? primaryColor : textColor + '18';
  const col = fromGuidance ? '#fff' : isMine ? '#2c3e50' : textColor;
  const label = fromGuidance ? 'Guidance Counselor' : sender === 'Anonymous' ? 'You (Anonymous)' : _esc(sender.split('@')[0]);
  let inner;
  if (m.isAttachment) {
    const sizeKB = m.fileSize ? (Number(m.fileSize)/1024).toFixed(1)+'KB' : '';
    const safeFileName = _esc(m.fileName || 'file');
    const data = String(m.fileData || '');
    if (!ATTACH_TYPES.test(data)) inner = '<div style="margin-top:6px;font-size:12px;opacity:.7">Attachment unavailable</div>';
    else {
      const key = c.id + '_' + (m.ts || 0);
      _attStore.set(key, data);
      inner = (m.isImage && /^data:image\//.test(data))
        ? '<img data-att="' + _esc(key) + '" alt="' + safeFileName + '" loading="lazy" style="max-width:200px;max-height:180px;border-radius:8px;display:block;margin-top:6px;cursor:zoom-in" onclick="openAttachment(this)" />'
        : '<a data-att="' + _esc(key) + '" download="' + safeFileName + '" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.25);color:inherit;text-decoration:none;font-size:12px">📎 ' + safeFileName + (sizeKB?' ('+sizeKB+')':'') + '</a>';
    }
  } else inner = '<span style="white-space:pre-wrap;overflow-wrap:anywhere">' + _esc(m.text) + '</span>';
  return '<div style="display:flex;flex-direction:' + (isMine?'row-reverse':'row') + ';gap:8px;align-items:flex-end">' +
    '<div style="max-width:78%;padding:9px 13px;border-radius:16px;font-size:13px;line-height:1.4;background:' + bg + ';color:' + col + '">' +
    '<div style="font-size:10px;font-weight:700;margin-bottom:3px;opacity:0.75">' + label + '</div>' +
    inner +
    '<div style="font-size:10px;margin-top:3px;opacity:0.6;text-align:right">' + _esc(m.time||'') + '</div>' +
    '</div></div>';
}

    // ── RENDER ──
    // The screen is described as one HTML string (as before), but it is no longer thrown away and
    // rebuilt on every click. morph() compares the new description with what is already on the page
    // and changes only what differs. That is what removes the lag: no flicker, no lost focus or
    // scroll position, no re-decoding of attached images, and CSS transitions (the mobile drawer) work.

    // Only the icons this app uses, inlined (replaces the 350 KB icon library and its page-wide scan).
    // Icon paths: Lucide v0.263 — ISC License, © Lucide Contributors.
    const ICONS = {"more-horizontal":"<circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"19\" cy=\"12\" r=\"1\" /><circle cx=\"5\" cy=\"12\" r=\"1\" />","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" /><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /><path d=\"M16 3.13a4 4 0 0 1 0 7.75\" />","search":"<circle cx=\"11\" cy=\"11\" r=\"8\" /><path d=\"m21 21-4.3-4.3\" />","megaphone":"<path d=\"m3 11 18-5v12L3 14v-3z\" /><path d=\"M11.6 16.8a3 3 0 1 1-5.8-1.6\" />","trash-2":"<path d=\"M3 6h18\" /><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" />","send":"<path d=\"m22 2-7 20-4-9-9-4Z\" /><path d=\"M22 2 11 13\" />","plus":"<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />","bell":"<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\" /><path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\" />","shield":"<path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\" />","paperclip":"<path d=\"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48\" />","message-circle":"<path d=\"m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z\" />","log-out":"<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" /><polyline points=\"16 17 21 12 16 7\" /><line x1=\"21\" x2=\"9\" y1=\"12\" y2=\"12\" />","languages":"<path d=\"m5 8 6 6\" /><path d=\"m4 14 6-6 2-3\" /><path d=\"M2 5h12\" /><path d=\"M7 2h1\" /><path d=\"m22 22-5-10-5 10\" /><path d=\"M14 18h6\" />","info":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M12 16v-4\" /><path d=\"M12 8h.01\" />","bell-ring":"<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9\" /><path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\" /><path d=\"M4 2C2.8 3.7 2 5.7 2 8\" /><path d=\"M22 8c0-2.3-.8-4.3-2-6\" />","alert-triangle":"<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z\" /><path d=\"M12 9v4\" /><path d=\"M12 17h.01\" />","x":"<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />","wrench":"<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\" />","user":"<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /><circle cx=\"12\" cy=\"7\" r=\"4\" />","settings-2":"<path d=\"M20 7h-9\" /><path d=\"M14 17H5\" /><circle cx=\"17\" cy=\"17\" r=\"3\" /><circle cx=\"7\" cy=\"7\" r=\"3\" />","settings":"<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />","message-square":"<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\" />","menu":"<line x1=\"4\" x2=\"20\" y1=\"12\" y2=\"12\" /><line x1=\"4\" x2=\"20\" y1=\"6\" y2=\"6\" /><line x1=\"4\" x2=\"20\" y1=\"18\" y2=\"18\" />","lock":"<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /><path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />","loader":"<line x1=\"12\" x2=\"12\" y1=\"2\" y2=\"6\" /><line x1=\"12\" x2=\"12\" y1=\"18\" y2=\"22\" /><line x1=\"4.93\" x2=\"7.76\" y1=\"4.93\" y2=\"7.76\" /><line x1=\"16.24\" x2=\"19.07\" y1=\"16.24\" y2=\"19.07\" /><line x1=\"2\" x2=\"6\" y1=\"12\" y2=\"12\" /><line x1=\"18\" x2=\"22\" y1=\"12\" y2=\"12\" /><line x1=\"4.93\" x2=\"7.76\" y1=\"19.07\" y2=\"16.24\" /><line x1=\"16.24\" x2=\"19.07\" y1=\"7.76\" y2=\"4.93\" />","history":"<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /><path d=\"M3 3v5h5\" /><path d=\"M12 7v5l4 2\" />","eye-off":"<path d=\"M9.88 9.88a3 3 0 1 0 4.24 4.24\" /><path d=\"M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68\" /><path d=\"M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61\" /><line x1=\"2\" x2=\"22\" y1=\"2\" y2=\"22\" />","external-link":"<path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" /><polyline points=\"15 3 21 3 21 9\" /><line x1=\"10\" x2=\"21\" y1=\"14\" y2=\"3\" />","clipboard-check":"<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /><path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /><path d=\"m9 14 2 2 4-4\" />","check-circle":"<path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\" /><polyline points=\"22 4 12 14.01 9 11.01\" />","calendar":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\" ry=\"2\" /><line x1=\"16\" x2=\"16\" y1=\"2\" y2=\"6\" /><line x1=\"8\" x2=\"8\" y1=\"2\" y2=\"6\" /><line x1=\"3\" x2=\"21\" y1=\"10\" y2=\"10\" />","arrow-left":"<path d=\"m12 19-7-7 7-7\" /><path d=\"M19 12H5\" />","layout-dashboard":"<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" /><rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />","file-text":"<path d=\"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z\" /><polyline points=\"14 2 14 8 20 8\" /><line x1=\"16\" x2=\"8\" y1=\"13\" y2=\"13\" /><line x1=\"16\" x2=\"8\" y1=\"17\" y2=\"17\" /><line x1=\"10\" x2=\"8\" y1=\"9\" y2=\"9\" />","heart":"<path d=\"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z\" />","shield-check":"<path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\" /><path d=\"m9 12 2 2 4-4\" />","moon":"<path d=\"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z\" />","sun":"<circle cx=\"12\" cy=\"12\" r=\"4\" /><path d=\"M12 2v2\" /><path d=\"M12 20v2\" /><path d=\"m4.93 4.93 1.41 1.41\" /><path d=\"m17.66 17.66 1.41 1.41\" /><path d=\"M2 12h2\" /><path d=\"M20 12h2\" /><path d=\"m6.34 17.66-1.41 1.41\" /><path d=\"m19.07 4.93-1.41 1.41\" />","chevron-up":"<path d=\"m18 15-6-6-6 6\" />","chevron-down":"<path d=\"m6 9 6 6 6-6\" />","log-in":"<path d=\"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4\" /><polyline points=\"10 17 15 12 10 7\" /><line x1=\"15\" x2=\"3\" y1=\"12\" y2=\"12\" />","check":"<polyline points=\"20 6 9 17 4 12\" />","eye":"<path d=\"M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />","image":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /><circle cx=\"9\" cy=\"9\" r=\"2\" /><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />","download":"<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /><polyline points=\"7 10 12 15 17 10\" /><line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />","clock":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><polyline points=\"12 6 12 12 16 14\" />","life-buoy":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"m4.93 4.93 4.24 4.24\"/><path d=\"m14.83 9.17 4.24-4.24\"/><path d=\"m14.83 14.83 4.24 4.24\"/><path d=\"m9.17 14.83-4.24 4.24\"/><circle cx=\"12\" cy=\"12\" r=\"4\" />","phone":"<path d=\"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z\" />","bar-chart-3":"<path d=\"M3 3v18h18\" /><path d=\"M18 17V9\" /><path d=\"M13 17V5\" /><path d=\"M8 17v-3\" />","hard-drive":"<line x1=\"22\" x2=\"2\" y1=\"12\" y2=\"12\" /><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\" /><line x1=\"6\" x2=\"6.01\" y1=\"16\" y2=\"16\" /><line x1=\"10\" x2=\"10.01\" y1=\"16\" y2=\"16\" />","user-check":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" /><polyline points=\"16 11 18 13 22 9\" />","check-check":"<path d=\"M18 6 7 17l-5-5\" /><path d=\"m22 10-7.5 7.5L13 16\" />","printer":"<polyline points=\"6 9 6 2 18 2 18 9\" /><path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\" /><rect width=\"12\" height=\"8\" x=\"6\" y=\"14\" />","filter":"<polygon points=\"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3\" />","user-plus":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><circle cx=\"9\" cy=\"7\" r=\"4\" /><line x1=\"19\" x2=\"19\" y1=\"8\" y2=\"14\" /><line x1=\"22\" x2=\"16\" y1=\"11\" y2=\"11\" />","venetian-mask":"<path d=\"M2 12a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V7h-5a8 8 0 0 0-5 2 8 8 0 0 0-5-2H2Z\" /><path d=\"M6 11c1.5 0 3 .5 3 2-2 0-3 0-3-2Z\" /><path d=\"M18 11c-1.5 0-3 .5-3 2 2 0 3 0 3-2Z\" />","book-open":"<path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\" /><path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\" />","calendar-plus":"<path d=\"M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8\" /><line x1=\"16\" x2=\"16\" y1=\"2\" y2=\"6\" /><line x1=\"8\" x2=\"8\" y1=\"2\" y2=\"6\" /><line x1=\"3\" x2=\"21\" y1=\"10\" y2=\"10\" /><line x1=\"19\" x2=\"19\" y1=\"16\" y2=\"22\" /><line x1=\"16\" x2=\"22\" y1=\"19\" y2=\"19\" />","calendar-clock":"<path d=\"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5\" /><path d=\"M16 2v4\" /><path d=\"M8 2v4\" /><path d=\"M3 10h5\" /><path d=\"M17.5 17.5 16 16.25V14\" /><path d=\"M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z\" />","smile":"<circle cx=\"12\" cy=\"12\" r=\"10\" /><path d=\"M8 14s1.5 2 4 2 4-2 4-2\" /><line x1=\"9\" x2=\"9.01\" y1=\"9\" y2=\"9\" /><line x1=\"15\" x2=\"15.01\" y1=\"9\" y2=\"9\" />","smartphone":"<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\" /><path d=\"M12 18h.01\" />","message-square-plus":"<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\" /><line x1=\"9\" x2=\"15\" y1=\"10\" y2=\"10\" /><line x1=\"12\" x2=\"12\" y1=\"7\" y2=\"13\" />","bell-plus":"<path d=\"M19.3 14.8C20.1 16.4 21 17 21 17H3s3-2 3-9c0-3.3 2.7-6 6-6 1 0 1.9.2 2.8.7\" /><path d=\"M10.3 21a1.94 1.94 0 0 0 3.4 0\" /><path d=\"M15 8h6\" /><path d=\"M18 5v6\" />","moon-star":"<path d=\"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z\" /><path d=\"M19 3v4\" /><path d=\"M21 5h-4\" />"};
    function iconSvg(name, attrs) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-lucide="' + name + '"' + (attrs || '') + '>' + (ICONS[name] || '') + '</svg>';
    }
    function inlineIcons(html) {
      return html.replace(/<i data-lucide="([a-z0-9-]+)"([^>]*)><\/i>/g, (m, name, attrs) => ICONS[name] ? iconSvg(name, attrs) : m);
    }
    // Kept so older call sites keep working
    const lucide = { createIcons() { document.querySelectorAll('i[data-lucide]').forEach(el => { el.outerHTML = inlineIcons(el.outerHTML); }); } };

    function _key(node) { return node.nodeType === 1 ? node.getAttribute('data-key') : null; }
    function _sameKind(a, b) {
      if (a.nodeType !== b.nodeType) return false;
      if (a.nodeType !== 1) return true;
      if (a.nodeName !== b.nodeName) return false;
      if (a.nodeName === 'INPUT' && a.getAttribute('type') !== b.getAttribute('type')) return false;
      return true;
    }
    function morphNode(o, n) {
      if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
      if (o.hasAttribute('data-live')) return;                 // updated by hand elsewhere (progress bars, status labels)
      const tag = o.nodeName, focused = (o === document.activeElement);
      // attributes
      const na = n.attributes;
      for (let i = 0; i < na.length; i++) {
        const a = na[i];
        if (o.getAttribute(a.name) !== a.value) {
          if (a.name === 'value' && tag === 'INPUT' && o.hasAttribute('data-keep') ) { o.setAttribute('value', a.value); if (!focused) o.value = a.value; }
          else o.setAttribute(a.name, a.value);
        }
      }
      const oa = o.attributes;
      for (let i = oa.length - 1; i >= 0; i--) {
        const name = oa[i].name;
        if (n.hasAttribute(name)) continue;
        if (tag === 'DETAILS' && name === 'open') continue;                    // the reader opened it — leave it open
        if ((name === 'src' || name === 'href') && o.hasAttribute('data-att')) continue;   // filled in after render
        o.removeAttribute(name);
      }
      // form fields: never touch what the person is typing in right now
      if (tag === 'INPUT') {
        const t = o.type;
        if (t !== 'file' && !o.hasAttribute('data-keep') && n.hasAttribute('value') && !focused && o.value !== n.getAttribute('value') && !_autofilled(o)) o.value = n.getAttribute('value');
        return;
      }
      if (tag === 'TEXTAREA') {
        const text = n.textContent;
        const changed = o.textContent !== text;
        if (changed) o.textContent = text;
        if (!focused && (o.hasAttribute('data-keep') ? changed : o.value !== text)) o.value = text;
        return;
      }
      morphChildren(o, n);
    }
    function morphChildren(oldParent, newParent) {
      let o = oldParent.firstChild, n = newParent.firstChild, keyed = null;
      while (n) {
        const next = n.nextSibling;
        const k = _key(n);
        let target = null;
        if (k !== null) {
          if (!keyed) { keyed = new Map(); for (let c = o; c; c = c.nextSibling) { const ck = _key(c); if (ck !== null) keyed.set(ck, c); } }
          const hit = keyed.get(k);
          if (hit && hit.parentNode === oldParent && n.hasAttribute('data-same')) {
            // keep(): this card's HTML is byte-for-byte what is already on screen — leave it exactly as it is
            keyed.delete(k);
            if (hit === o) o = o.nextSibling; else oldParent.insertBefore(hit, o);
            n = next; continue;
          }
          if (hit && hit.parentNode === oldParent && _sameKind(hit, n)) { target = hit; keyed.delete(k); }
        } else {
          let c = o;
          while (c && _key(c) !== null) c = c.nextSibling;
          if (c && _sameKind(c, n)) target = c;
        }
        if (target) {
          if (target === o) o = o.nextSibling; else oldParent.insertBefore(target, o);
          // identical subtree (the usual case for all but one card): the browser compares it natively and we move on
          if (!(target.nodeType === 1 && target.isEqualNode(n))) morphNode(target, n);
        } else {
          oldParent.insertBefore(n, o);          // brand-new node: move it straight in
        }
        n = next;
      }
      while (o) { const nx = o.nextSibling; oldParent.removeChild(o); o = nx; }
    }
    function _autofilled(el) { try { return el.matches(':autofill'); } catch (e) { return false; } }
    // Fields someone has typed in. After an update, any of them whose value was reset in code
    // (a sent message, a cleared form) is brought back in line — but never the one being typed in.
    const _dirtyFields = new Set();
    document.addEventListener('input', (e) => { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) _dirtyFields.add(t); }, true);
    function syncDirtyFields() {
      _dirtyFields.forEach(el => {
        if (!el.isConnected) { _dirtyFields.delete(el); return; }
        if (el === document.activeElement || el.hasAttribute('data-keep') || el.type === 'file') return;
        const want = el.tagName === 'TEXTAREA' ? el.textContent : el.getAttribute('value');
        if (want == null) return;
        if (el.value !== want) el.value = want;
        _dirtyFields.delete(el);
      });
    }
    // keep(key, html): for big repeated blocks (one card per posting / consultation). If the card's HTML is
    // identical to the last time it was drawn, a tiny placeholder is sent instead, so an update that touches
    // one card no longer makes the browser re-read all 150 of them.
    let _cardMemo = new Map(), _cardNext = new Map(), _mountedKeys = new Set();
    function keep(key, html) {
      _cardNext.set(key, html);
      if (_mountedKeys.has(key) && _cardMemo.get(key) === html) return '<div data-key="' + key + '" data-same></div>';
      return html;
    }
    function setHTML(container, html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = inlineIcons(html);
      if (appLang === 'tl' && isAuthenticated && currentRole !== 'student') translateTree(tpl.content);
      // remember where each kept card currently lives, in case the layout around it changed shape
      let live = null;
      if (html.indexOf('data-same') >= 0) { live = new Map(); container.querySelectorAll('[data-key]').forEach(el => live.set(el.getAttribute('data-key'), el)); }
      morphChildren(container, tpl.content);
      if (live) container.querySelectorAll('[data-same]').forEach(ph => {
        const k = ph.getAttribute('data-key'), el = live.get(k);
        if (el && el !== ph && !el.hasAttribute('data-same')) { ph.replaceWith(el); return; }
        const t = document.createElement('template'); t.innerHTML = inlineIcons(_cardNext.get(k) || ''); ph.replaceWith(t.content);
      });
      syncDirtyFields();
      _cardMemo = _cardNext; _cardNext = new Map();
      _mountedKeys = new Set();
      if (_cardMemo.size) container.querySelectorAll('[data-key]').forEach(el => _mountedKeys.add(el.getAttribute('data-key')));
    }

    // Attachments are kept out of the HTML string (a 1 MB image used to be re-parsed on every update)
    const _attStore = new Map();
    function hydrateAttachments() {
      document.querySelectorAll('[data-att]').forEach(el => {
        const key = el.getAttribute('data-att');
        if (el._att === key) return;
        const data = _attStore.get(key);
        if (!data) return;
        if (el.tagName === 'IMG') el.src = data; else el.setAttribute('href', data);
        el._att = key;
      });
    }

    function filterPostsInDOM(query) {
      const q = (query || '').toLowerCase();
      const cards = document.querySelectorAll('[data-post-id]');
      let anyVisible = false;
      cards.forEach(card => {
        const text = (card.getAttribute('data-search-text') || '').toLowerCase();
        const show = !q || text.includes(q);
        card.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
      });
      const emptyEl = document.getElementById('postings-no-match');
      if (emptyEl) emptyEl.style.display = (!anyVisible && cards.length > 0) ? '' : 'none';
    }

    // Typing no longer blocks updates (the field being typed in is simply left alone), so these are no-ops
    // kept for the inline handlers that still call them.
    function onFieldInput() {}
    function isUserTyping() { return false; }
    function safeRender() { render(); }

    // Coalesces bursts of Firestore snapshots (4 listeners fire at start) into ONE update on the next frame
    let _schedPending = false;
    function scheduleRender() {
      if (_schedPending) return;
      _schedPending = true;
      const run = () => { _schedPending = false; render(); };
      if (document.hidden) setTimeout(run, 200); else requestAnimationFrame(run);
    }

    let _lastLang = null;
    let booting = !!localStorage.getItem('qh_saved_role');   // returning user: hold the splash instead of flashing the landing page
    let _lastPage = null, _lastNavItem = null, _notifTimer = null;

    function render() {
      config=darkMode?{...config,background_color:'#1a1a1a',surface_color:'#2d2d2d',text_color:'#e6e6e6'}:{...defaultConfig};
      document.body.style.colorScheme = darkMode ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
      if (booting && !isAuthenticated) return;                // splash stays until the saved session is checked

      let html;
      _cardNext = new Map();
      if (_lastLang !== appLang) { _lastLang = appLang; _cardMemo = new Map(); _mountedKeys = new Set(); }
      try {
        html = !isAuthenticated ? (selectedRoleForLogin ? renderGateway() : renderLanding()) : renderDashboard();
      } catch (err) {
        _cardNext = new Map();
        console.error('[QHsafety] render failed:', err);
        html = `<div data-key="crash" class="screen grid-bg" style="display:flex;align-items:center;justify-content:center;padding:24px"><div class="p-6 rounded-xl" style="background:#fff;max-width:420px;text-align:center;color:#2c3e50"><h2 class="font-bold mb-2">Something went wrong on this page</h2><p class="text-sm mb-4" style="color:#5a6a7a">Your data is safe. Reload to continue.</p><button onclick="location.reload()" class="px-6 py-3 rounded-lg font-semibold" style="background:#ffee58;color:#2c3e50">Reload</button></div></div>`;
      }
      setHTML(app, html);
      hydrateAttachments();
      if (isAuthenticated) { observeSeenCards(); scheduleMarkSeen(); }

      const page = isAuthenticated ? activeSidebarItem : (selectedRoleForLogin ? 'gateway' : 'landing');
      const main = document.getElementById('main-scroll');
      if (page !== _lastPage) { if (main) main.scrollTop = 0; _lastPage = page; }

      // re-apply the search filter to any newly added cards
      if (postingSearchQuery) filterPostsInDOM(postingSearchQuery);

      if (isAuthenticated) {
        if (_lastNavItem !== activeSidebarItem) {
          _lastNavItem = activeSidebarItem;
          const activeNavBtn = document.querySelector('.mobile-bottom-nav button.active');
          if (activeNavBtn && activeNavBtn.scrollIntoView) activeNavBtn.scrollIntoView({inline:'center',block:'nearest'});
        }
        // Keep notification button/indicator in sync with OneSignal state (at most once per burst)
        clearTimeout(_notifTimer);
        _notifTimer = setTimeout(updateNotifUI, 250);
      }
    }

    function goTo(item) {
      activeSidebarItem = item;
      localStorage.setItem('qh_last_page', item);
      mobileDrawerOpen = false;
      render();
    }
    function toggleMeetScheduler(id) {
      const wasOpen = !!showMeetScheduler[id];
      showMeetScheduler = {};                      // one scheduler at a time: they share a single draft
      consultMeetDraft = {date:'',time:'',link:'',notes:''};
      if (!wasOpen) showMeetScheduler[id] = true;
      render();
    }
    function riskLabel(level) { return tr(String(level || 'Low').toLowerCase()) + ' ' + (appLang === 'tl' ? 'Panganib' : 'Risk'); }

    // Google "G" mark for the sign-in button
    const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style="flex-shrink:0"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
    function googleButton(role, label) {
      const busy = authBusy === 'google';
      return `<button onclick="handleGoogleSignIn('${role}')" ${authBusy?'disabled':''} class="google-btn w-full">${busy?'<span class="qh-spin"></span>':GOOGLE_G}<span>${busy?'Opening Google…':label}</span></button>`;
    }
    const spinner = '<span class="qh-spin"></span>';

    function renderLanding() {
      const fs=config.font_size||16;
      const c=config, on=darkMode;
      return `
<div data-key="landing" class="grid-bg screen" style="width:100%;overflow-y:auto;background-color:${c.background_color}">
  <nav class="flex items-center justify-between px-6 py-4" style="background:#2c3e50">
    ${logoLockup(30,true)}
    <div class="flex items-center gap-2">
      <button onclick="showHelp()" class="help-btn compact"><i data-lucide="life-buoy" style="width:16px;height:16px"></i><span>${tr('getHelp')}</span></button>
      <button onclick="showLandingSettings=!showLandingSettings;render()" aria-label="Settings" class="p-2 rounded-lg hover:opacity-80" style="color:#fff"><i data-lucide="settings" style="width:20px;height:20px"></i></button>
    </div>
  </nav>
  ${showLandingSettings?`<div style="position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);padding:16px" onclick="if(event.target===this){showLandingSettings=false;render()}"><div class="fade-in" style="background:${c.surface_color};border:1px solid ${c.text_color}14;border-radius:20px;padding:24px;width:360px;max-width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.25)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px"><h2 style="font-weight:700;font-size:18px;color:${c.text_color};margin:0">${tr('settings')}</h2><button onclick="showLandingSettings=false;render()" aria-label="Close" style="width:32px;height:32px;border-radius:50%;background:${c.text_color}12;display:flex;align-items:center;justify-content:center;color:${c.text_color}"><i data-lucide="x" style="width:16px;height:16px"></i></button></div><div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:14px;background:${c.text_color}07;margin-bottom:12px"><div style="display:flex;align-items:center;gap:12px"><i data-lucide="${on?'moon':'sun'}" style="width:18px;height:18px;color:${c.text_color}"></i><div><div style="font-weight:600;font-size:14px;color:${c.text_color}">${tr('darkMode')}</div><div style="font-size:11px;color:${c.text_color}88;margin-top:1px">${on?'On':'Off'}</div></div></div><button role="switch" aria-checked="${on}" aria-label="${tr('darkMode')}" onclick="darkMode=!darkMode;localStorage.setItem('qh_dark_mode',darkMode);render()" class="qh-switch ${on?'on':''}"><span></span></button></div><div style="padding:14px 16px;border-radius:14px;background:${c.text_color}07"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><i data-lucide="languages" style="width:18px;height:18px;color:${c.text_color}"></i><div style="font-weight:600;font-size:14px;color:${c.text_color}">${tr('langSetting')}</div></div><div style="display:flex;gap:8px">${[['en','English'],['tl','Filipino']].map(l=>`<button onclick="appLang='${l[0]}';localStorage.setItem('qh_lang','${l[0]}');render()" style="flex:1;padding:10px 0;border-radius:10px;font-weight:700;font-size:13px;text-align:center;border:2px solid ${appLang===l[0]?c.primary_action_color:'transparent'};background:${appLang===l[0]?c.primary_action_color+'22':'transparent'};color:${c.text_color}">${l[1]}</button>`).join('')}</div></div></div></div>`:''}
  <section class="flex flex-col items-center justify-center text-center px-6 hero fade-in">
    <div class="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-6 mono" style="background:${c.secondary_action_color}33;color:${c.text_color}">School Safety Platform</div>
    <div class="mb-4">${logoMark(88, darkMode)}</div>
    <h1 class="font-bold leading-tight mb-4 hero-title" style="color:${c.text_color}"><span style="color:${darkMode?c.primary_action_color:'#f9a825'}">QH</span>safety</h1>
    <p class="max-w-lg mb-8" style="font-size:${fs}px;color:${c.text_color}aa">${c.hero_subtitle}</p>
    ${loginError?`<div class="p-3 rounded-lg mb-6 text-sm max-w-sm w-full" role="alert" style="background:#fdecea;color:#b71c1c;border:1px solid #ef9a9a">${loginError}</div>`:''}
    <p class="text-sm font-semibold mb-4" style="color:${c.text_color}">${tr('selectRole')}</p>
    <div class="flex flex-col sm:flex-row gap-3 role-row">
      <button onclick="selectedRoleForLogin='student';currentAuthFlow='login';loginError='';render()" class="px-8 py-3 rounded-lg font-bold card-hover flex items-center gap-2 justify-center" style="background:${c.primary_action_color};color:#2c3e50"><i data-lucide="user" style="width:20px;height:20px"></i>${tr('student')}</button>
      <button onclick="selectedRoleForLogin='guidance';loginError='';render()" class="px-8 py-3 rounded-lg font-bold card-hover flex items-center gap-2 justify-center" style="background:${c.secondary_action_color};color:#2c3e50"><i data-lucide="users" style="width:20px;height:20px"></i>${tr('counselor')}</button>
      <button onclick="selectedRoleForLogin='admin';loginError='';render()" class="px-8 py-3 rounded-lg font-bold card-hover flex items-center gap-2 justify-center" style="background:#90caf9;color:#2c3e50"><i data-lucide="shield" style="width:20px;height:20px"></i>${tr('admin')}</button>
    </div>
    <div class="quick-google">
      <div class="or-line" style="color:${c.text_color}77"><span>${appLang==='tl'?'o mabilisang pasok para sa estudyante':'or quick student sign-in'}</span></div>
      ${googleButton('student', appLang==='tl'?'Magpatuloy gamit ang Google':'Continue with Google')}
      <button onclick="handleAnonymousSignIn()" ${authBusy?'disabled':''} class="anon-btn w-full" style="color:${c.text_color};border-color:${c.text_color}33">${authBusy==='anon'?spinner:'<i data-lucide="eye-off" style="width:16px;height:16px"></i>'}<span>${tr('continueAnonLong')}</span></button>
      <p style="font-size:12px;color:${c.text_color}88;margin-top:8px;line-height:1.5">${tr('anonHint')}</p>
    </div>
  </section>
  <section class="max-w-4xl mx-auto px-6 pb-16">
    <h2 class="font-bold text-center mb-4" style="font-size:${fs*1.5}px;color:${c.text_color}">${tr('aboutMission')}</h2>
    <p class="text-center max-w-2xl mx-auto mb-8" style="color:${c.text_color}aa;font-size:${fs}px">${tr('aboutDesc')}</p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${[{icon:'shield-check',title:tr('howToUse'),desc:tr('howToUseDesc')},{icon:'file-text',title:tr('termsPrivacy'),desc:tr('termsDesc')},{icon:'heart',title:tr('weCare'),desc:tr('weCareDesc')}].map(x=>`<div class="p-6 rounded-xl card-hover" style="background:${c.surface_color};border:1px solid ${c.text_color}14"><div class="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style="background:${c.primary_action_color}33"><i data-lucide="${x.icon}" style="width:20px;height:20px;color:${c.text_color}"></i></div><h3 class="font-bold mb-2" style="font-size:${fs*1.1}px;color:${c.text_color}">${x.title}</h3><p style="font-size:${fs*0.875}px;color:${c.text_color}99">${x.desc}</p></div>`).join('')}
    </div>
  </section>
</div>`;
    }

    function renderGateway() {
      const fs=config.font_size||16, c=config, role=selectedRoleForLogin;
      const roleName = role==='student'?'Student':role==='guidance'?'Counselor':'Administrator';
      const field = `width:100%;padding:12px;border:1px solid ${c.text_color}22;border-radius:8px;background:${c.background_color};color:${c.text_color};font-size:${fs}px`;
      const label = `display:block;font-size:${fs*0.875}px;font-weight:600;color:${c.text_color};margin-bottom:6px`;
      const primary = `background:${c.primary_action_color};color:#2c3e50;font-size:${fs}px`;
      const ghost = `background:transparent;color:${c.text_color}aa;border:1px solid ${c.text_color}22`;
      const err = (m) => m ? `<div class="p-3 rounded-lg mb-4 text-sm" role="alert" style="background:#fdecea;color:#b71c1c;border:1px solid #ef9a9a;text-align:center">${m}</div>` : '';
      const mode = showForgotPassword ? 'reset' : (currentAuthFlow==='signup' && role==='student') ? 'signup' : 'login';
      return `
<div data-key="gateway" class="grid-bg screen" style="width:100%;display:flex;flex-direction:column;align-items:center;padding:72px 20px 32px;background-color:${c.background_color};overflow-y:auto;position:relative">
  <button onclick="selectedRoleForLogin=null;currentAuthFlow='login';showForgotPassword=false;signupEmail='';signupPassword='';signupConfirmPassword='';signupError='';loginEmail='';loginPassword='';loginError='';forgotPasswordEmail='';forgotPasswordError='';forgotPasswordSuccess='';render()" class="absolute top-6 left-6 flex items-center gap-2 text-sm font-medium" style="color:${c.text_color}aa"><i data-lucide="arrow-left" style="width:16px;height:16px"></i> Back</button>
  <div class="w-full max-w-sm fade-in" style="margin:auto 0">
    <div class="text-center mb-6">
      <span style="display:inline-flex">${logoLockup(44, darkMode)}</span>
      <p style="color:${c.text_color}99;font-size:${fs}px;margin-top:8px">${mode==='reset'?'Reset password':mode==='signup'?'Create account':'Log in'} as ${roleName}</p>
    </div>
    <div class="p-6 rounded-xl" style="background:${c.surface_color};border:1px solid ${c.text_color}14">
      ${mode==='reset'?`
        ${err(forgotPasswordError)}
        ${forgotPasswordSuccess?`<div class="p-3 rounded-lg mb-4 text-sm" role="status" style="background:#e8f5e9;color:#1b5e20;border:1px solid #a5d6a7;text-align:center">${forgotPasswordSuccess}</div>`:''}
        <div class="mb-4"><label for="fp-email" style="${label}">Email</label><input id="fp-email" type="email" autocomplete="email" value="${_esc(forgotPasswordEmail)}" oninput="forgotPasswordEmail=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();handleForgotPassword();}" style="${field}" placeholder="Enter your email" /></div>
        <button onclick="handleForgotPassword()" ${authBusy?'disabled':''} class="w-full px-6 py-3 rounded-lg font-semibold btn-row" style="${primary}">${authBusy==='reset'?spinner+'Sending…':'Send reset email'}</button>
        <button onclick="showForgotPassword=false;forgotPasswordError='';forgotPasswordSuccess='';render()" class="w-full mt-3 px-6 py-3 rounded-lg font-semibold text-sm btn-row" style="${ghost}">Back to login</button>
      `:`
        ${googleButton(role, mode==='signup'?'Sign up with Google':'Continue with Google')}
        <div class="or-line" style="color:${c.text_color}77"><span>or use email</span></div>
        ${role==='student'?`
        <div class="flex gap-2 mb-5 p-1 rounded-lg" style="background:${c.text_color}0d">
          <button onclick="currentAuthFlow='login';loginError='';render()" class="flex-1 py-2 rounded-md text-sm font-semibold btn-row" style="background:${mode==='login'?c.surface_color:'transparent'};color:${c.text_color};${mode==='login'?'box-shadow:0 1px 3px rgba(0,0,0,.12)':''}">Log in</button>
          <button onclick="currentAuthFlow='signup';signupError='';render()" class="flex-1 py-2 rounded-md text-sm font-semibold btn-row" style="background:${mode==='signup'?c.surface_color:'transparent'};color:${c.text_color};${mode==='signup'?'box-shadow:0 1px 3px rgba(0,0,0,.12)':''}">Sign up</button>
        </div>`:''}
        ${mode==='signup'?`
          ${err(signupError)}
          <p class="mb-4" style="font-size:12px;color:${c.text_color}99;line-height:1.5">Use your <strong>Gmail</strong> address. We'll email a link you must click before your first login.</p>
          <div class="mb-4"><label for="su-email" style="${label}">Email</label><input id="su-email" type="email" autocomplete="email" value="${_esc(signupEmail)}" oninput="signupEmail=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();handleSignup();}" style="${field}" placeholder="yourname@gmail.com" /></div>
          <div class="mb-4"><label for="su-pass" style="${label}">Password</label><input id="su-pass" type="password" autocomplete="new-password" value="${_esc(signupPassword)}" oninput="signupPassword=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();handleSignup();}" style="${field}" placeholder="At least 6 characters" /></div>
          <div class="mb-5"><label for="su-confirm" style="${label}">Confirm password</label><input id="su-confirm" type="password" autocomplete="new-password" value="${_esc(signupConfirmPassword)}" oninput="signupConfirmPassword=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();handleSignup();}" style="${field}" placeholder="Re-enter password" /></div>
          <button onclick="handleSignup()" ${authBusy?'disabled':''} class="w-full px-6 py-3 rounded-lg font-semibold btn-row" style="${primary}">${authBusy==='signup'?spinner+'Creating account…':'Create account'}</button>
        `:`
          ${err(loginError)}
          ${role!=='student'?`<p class="mb-4" style="font-size:12px;color:${c.text_color}99;line-height:1.5">Use the account your administrator created for you.</p>`:''}
          <div class="mb-4"><label for="li-email" style="${label}">Email</label><input id="li-email" type="email" autocomplete="username" value="${_esc(loginEmail)}" oninput="loginEmail=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();handleLogin('${role}');}" style="${field}" placeholder="Enter email" /></div>
          <div class="mb-5"><label for="li-pass" style="${label}">Password</label><input id="li-pass" type="password" autocomplete="current-password" value="${_esc(loginPassword)}" oninput="loginPassword=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();handleLogin('${role}');}" style="${field}" placeholder="Enter password" /></div>
          <button onclick="handleLogin('${role}')" ${authBusy?'disabled':''} class="w-full px-6 py-3 rounded-lg font-semibold btn-row" style="${primary}">${authBusy==='login'?spinner+'Logging in…':'Log in'}</button>
          <button onclick="showForgotPassword=true;forgotPasswordEmail=loginEmail;forgotPasswordError='';forgotPasswordSuccess='';render()" class="w-full mt-3 px-6 py-2.5 rounded-lg font-semibold text-sm btn-row" style="${ghost}">Forgot password?</button>
        `}
      `}
    </div>
  </div>
</div>`;
    }

    // ═══════════════════════════ FEATURES ADDED IN v9 ═══════════════════════════

    // ── Edit these for your school ──
    const HELP_CONTACTS = {
      // Shown at the top of the help screen. Leave a field empty to hide it.
      school: { name: 'Guidance Office', phone: '', room: '', hours: 'School days, 7:00 AM – 5:00 PM' },
      // Checked October 2026 (DepEd Lusog-Isip page for NCMH; CWC/DSWD for Makabata). Re-check once a year.
      lines: [
        { name: 'NCMH Crisis Hotline', note: { en: 'Someone to talk to, any time. Free and confidential.', tl: 'May makakausap ka, kahit anong oras. Libre at kumpidensyal.' },
          numbers: [['1553', 'Landline, toll-free in Luzon'], ['0917-899-8727', 'Globe / TM'], ['0966-351-4518', 'Globe / TM'], ['0908-639-2672', 'Smart / Sun / TNT']] },
        { name: 'Makabata Helpline', note: { en: 'For abuse, bullying, or anyone hurting a child.', tl: 'Para sa pang-aabuso, bullying, o sinumang nananakit ng bata.' }, numbers: [['1383', '']] },
        { name: 'Emergency', note: { en: 'Police, ambulance, fire — if someone is in danger right now.', tl: 'Pulis, ambulansya, bumbero — kung may nasa panganib ngayon.' }, numbers: [['911', '']] },
      ],
    };
    const IDLE_LIMIT_MIN = { student: 15, guidance: 30, admin: 30 };   // auto-logout after this many minutes without activity
    const OVERDUE_MIN    = { High: 30, Medium: 240 };                  // "waiting too long" thresholds for counselors

    Object.assign(T.en, {
      reports:'Reports', storagePage:'Storage', getHelp:'Get help now', continueAnonLong:'Continue without an account',
      anonHint:'No name, no email. Your posts stay on this device\'s session.',
      pOptional:'optional', pStrand:'Strand', pAge:'Age',
      pHelpHow:'How would you like to be helped?', pMeetNote:'This will be sent as a consultation request so a counselor can schedule it with you. You will find it under Consultations.', pNeedGrade:'Please pick your grade level so the counselor can schedule you.', pSentConsult:'Sent as a consultation request — a counselor will schedule it with you',
      aboutMe:'About me', aboutOther:'About someone else', aboutWho:'Who are you worried about? (optional — a name, nickname or section)',
      stSent:'Sent — not seen yet', stSeen:'Seen by a counselor', stReplied:'A counselor replied', typing:'Counselor is typing…', isNew:'New',
      cGuide:'<strong>How this works:</strong> Tell us what is going on. A counselor will read it and reply here. What you write stays between you and the guidance office.',
      cNew:'New consultation request', cGrade:'Grade level', cJHS:'Junior High School', cSHS:'Senior High School', cPickGrade:'Please select your grade level', cSelected:'selected',
      cReason:'Reason / topic', cReasonPh:'e.g. Academic stress, family issue, personal problem…', cPriority:'Priority level', cFeel:'How are you feeling right now?',
      cContact:'Preferred contact method', cDescribe:'Describe your concern', cDescribePh:'Share as much or as little as you feel comfortable with. Everything is confidential.',
      moods:['Very sad','Sad','Neutral','Good','Great'], cChat:'Chat', cMeet:'Google Meet', cFace:'Face to face', cPhone:'Phone call',
      chatTitle:'Consultation chat', msgCounselor:'Message the counselor…', noMsgs:'No messages yet.', startBelow:'Start the conversation below.', chatClosed:'Chat closed — consultation resolved.',
      comments:'Comments', addComment:'Add a comment…', noComments:'No comments yet.', attach:'Attach a file', apptStatus:'Appointment status', updateMood:'Update your mood:',
      helpTitle:'You are not alone', helpLead:'If you are in danger or thinking about hurting yourself, please reach out now. These lines are free.',
      helpAfter:'Thank you for telling us. The guidance office has been notified and a counselor will reach out to you. You do not have to wait if things feel urgent:',
      helpFriend:'Thank you for looking out for them. The guidance office has been notified. If they are in danger right now, do not wait:',
      helpSchool:'At school', helpClose:'Close', call:'Call', idleTitle:'Still there?', idleBody:'For your privacy you will be signed out in one minute.', idleStay:'I\'m still here',
      idleOut:'You were signed out after a while without activity, to keep your posts private.',
    });
    Object.assign(T.tl, {
      reports:'Mga Ulat', storagePage:'Storage', getHelp:'Humingi ng tulong ngayon', continueAnonLong:'Magpatuloy nang walang account',
      anonHint:'Walang pangalan, walang email. Mananatili ang iyong mga post sa session ng device na ito.',
      pOptional:'opsyonal', pStrand:'Strand', pAge:'Edad',
      pHelpHow:'Paano mo gustong matulungan?', pMeetNote:'Ipapadala ito bilang kahilingan sa konsultasyon para ma-iskedyul ka ng counselor. Makikita mo ito sa Consultations.', pNeedGrade:'Pakipili ang iyong baitang para ma-iskedyul ka ng counselor.', pSentConsult:'Naipadala bilang kahilingan sa konsultasyon — iiskedyul ka ng counselor',
      aboutMe:'Tungkol sa akin', aboutOther:'Tungkol sa ibang tao', aboutWho:'Sino ang inaalala mo? (opsyonal — pangalan, palayaw o section)',
      stSent:'Naipadala — hindi pa nababasa', stSeen:'Nabasa na ng counselor', stReplied:'Sumagot na ang counselor', typing:'Nagta-type ang counselor…', isNew:'Bago',
      cGuide:'<strong>Paano ito gumagana:</strong> Sabihin sa amin ang nangyayari. Babasahin ito ng counselor at sasagot dito. Mananatili ito sa pagitan mo at ng guidance office.',
      cNew:'Bagong kahilingan sa konsultasyon', cGrade:'Baitang', cJHS:'Junior High School', cSHS:'Senior High School', cPickGrade:'Pakipili ang iyong baitang', cSelected:'ang napili',
      cReason:'Dahilan / paksa', cReasonPh:'hal. Stress sa pag-aaral, problema sa pamilya, personal na problema…', cPriority:'Antas ng prioridad', cFeel:'Kumusta ang pakiramdam mo ngayon?',
      cContact:'Paano mo gustong makausap', cDescribe:'Ilarawan ang iyong alalahanin', cDescribePh:'Ibahagi kung gaano karami o kakaunti ang komportable ka. Lahat ay kumpidensyal.',
      moods:['Sobrang lungkot','Malungkot','Ayos lang','Mabuti','Napakabuti'], cChat:'Chat', cMeet:'Google Meet', cFace:'Harapan', cPhone:'Tawag sa telepono',
      chatTitle:'Chat ng konsultasyon', msgCounselor:'Mag-mensahe sa counselor…', noMsgs:'Wala pang mensahe.', startBelow:'Simulan ang usapan sa ibaba.', chatClosed:'Sarado na ang chat — nalutas na ang konsultasyon.',
      comments:'Mga komento', addComment:'Magdagdag ng komento…', noComments:'Wala pang komento.', attach:'Mag-attach ng file', apptStatus:'Katayuan ng appointment', updateMood:'I-update ang iyong pakiramdam:',
      helpTitle:'Hindi ka nag-iisa', helpLead:'Kung nasa panganib ka o naiisip mong saktan ang sarili mo, humingi ng tulong ngayon. Libre ang mga linyang ito.',
      helpAfter:'Salamat sa pagsasabi sa amin. Naabisuhan na ang guidance office at may counselor na makikipag-ugnayan sa iyo. Hindi mo kailangang maghintay kung apurahan:',
      helpFriend:'Salamat sa pagmamalasakit mo sa kanila. Naabisuhan na ang guidance office. Kung nasa panganib sila ngayon, huwag nang maghintay:',
      helpSchool:'Sa paaralan', helpClose:'Isara', call:'Tawagan', idleTitle:'Nandiyan ka pa ba?', idleBody:'Para sa iyong privacy, masa-sign out ka sa loob ng isang minuto.', idleStay:'Nandito pa ako',
      idleOut:'Na-sign out ka dahil matagal na walang aktibidad, para manatiling pribado ang iyong mga post.',
    });
    function trList(key) { const v = (T[appLang] || T.en)[key] || T.en[key]; return Array.isArray(v) ? v : []; }

    // ── LOGO ── a shield with a speech bubble inside: "a safe place to speak up"
    function logoMark(size, onDark) {
      // flat QH shield: navy with yellow lettering on light backgrounds, inverted on dark ones
      const inner = onDark ? "<path d=\"M24 3.5 40.5 9.6v12.9c0 10.2-6.7 18.3-16.5 22-9.8-3.7-16.5-11.8-16.5-22V9.6Z\" fill=\"#ffee58\" stroke=\"#ffee58\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M24 6.9 37.6 11.9v10.6c0 8.5-5.5 15.3-13.6 18.6-8.1-3.3-13.6-10.1-13.6-18.6V11.9Z\" fill=\"none\" stroke=\"#2c3e50\" stroke-width=\"1.1\" stroke-linejoin=\"round\" opacity=\".5\"/><g fill=\"none\" stroke=\"#2c3e50\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><ellipse cx=\"18\" cy=\"21.9\" rx=\"4.2\" ry=\"5.1\"/><path d=\"M19.9 24.3l2.5 3\"/><path d=\"M27.2 17.1v9.6M34.2 17.1v9.6M27.2 21.9h7\"/></g>" : "<path d=\"M24 3.5 40.5 9.6v12.9c0 10.2-6.7 18.3-16.5 22-9.8-3.7-16.5-11.8-16.5-22V9.6Z\" fill=\"#2c3e50\" stroke=\"#2c3e50\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M24 6.9 37.6 11.9v10.6c0 8.5-5.5 15.3-13.6 18.6-8.1-3.3-13.6-10.1-13.6-18.6V11.9Z\" fill=\"none\" stroke=\"#ffee58\" stroke-width=\"1.1\" stroke-linejoin=\"round\" opacity=\".5\"/><g fill=\"none\" stroke=\"#ffee58\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><ellipse cx=\"18\" cy=\"21.9\" rx=\"4.2\" ry=\"5.1\"/><path d=\"M19.9 24.3l2.5 3\"/><path d=\"M27.2 17.1v9.6M34.2 17.1v9.6M27.2 21.9h7\"/></g>";
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" role="img" aria-label="QHsafety logo" style="flex-shrink:0;display:block">' + inner + '</svg>';
    }
    function logoLockup(size, onDark) {
      const ink = onDark ? '#fff' : config.text_color;
      return '<span class="qh-logo" style="font-size:' + Math.round(size * 0.62) + 'px;color:' + ink + '">' + logoMark(size, onDark) + '<span><b>QH</b>safety</span></span>';
    }

    // ── HELP SCREEN ── reachable from every page, logged in or not
    function showHelp(mode) {
      const old = document.getElementById('qh-help'); if (old) old.remove();
      const lead = (mode === 'after' ? tr('helpAfter') : mode === 'friend' ? tr('helpFriend') : tr('helpLead')) + (mode && isAfterHours() ? ' <strong>' + tr('afterHours') + ' (' + (SCHOOL_HOURS.label[appLang] || SCHOOL_HOURS.label.en) + ').</strong>' : '');
      const sc = HELP_CONTACTS.school;
      const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');
      const schoolBits = [sc.room, sc.hours].filter(Boolean).map(_esc).join(' · ');
      const el = document.createElement('div');
      el.id = 'qh-help'; el.className = 'qh-sheet-wrap';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'qh-help-title');
      el.innerHTML = '<div class="qh-sheet">' +
        '<div class="qh-sheet-head"><div class="qh-help-icon">' + iconSvg('life-buoy', ' style="width:22px;height:22px"') + '</div><h2 id="qh-help-title">' + tr('helpTitle') + '</h2>' +
        '<button class="qh-sheet-x" aria-label="' + tr('helpClose') + '" onclick="closeSheet(\'qh-help\')">' + iconSvg('x', ' style="width:18px;height:18px"') + '</button></div>' +
        '<p class="qh-sheet-lead">' + lead + '</p>' +
        HELP_CONTACTS.lines.map(l => '<div class="qh-line"><div class="qh-line-name">' + _esc(l.name) + '</div><div class="qh-line-note">' + _esc(l.note[appLang] || l.note.en) + '</div><div class="qh-line-nums">' +
          l.numbers.map(n => '<a href="' + tel(n[0]) + '">' + iconSvg('phone', ' style="width:14px;height:14px"') + '<span><b>' + _esc(n[0]) + '</b>' + (n[1] ? '<small>' + _esc(n[1]) + '</small>' : '') + '</span></a>').join('') + '</div></div>').join('') +
        '<div class="qh-line"><div class="qh-line-name">' + tr('helpSchool') + ' — ' + _esc(sc.name) + '</div>' + (schoolBits ? '<div class="qh-line-note">' + schoolBits + '</div>' : '') +
        (sc.phone ? '<div class="qh-line-nums"><a href="' + tel(sc.phone) + '">' + iconSvg('phone', ' style="width:14px;height:14px"') + '<span><b>' + _esc(sc.phone) + '</b></span></a></div>' : '') + '</div>' +
        '<button class="qh-sheet-close" onclick="closeSheet(\'qh-help\')">' + tr('helpClose') + '</button></div>';
      el.addEventListener('click', (e) => { if (e.target === el) closeSheet('qh-help'); });
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('open'));
      const x = el.querySelector('.qh-sheet-x'); if (x) x.focus();
    }
    function closeSheet(id) { const el = document.getElementById(id); if (el) el.remove(); }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet('qh-help'); closeSheet('qh-history'); } });

    // After a serious post the student sees where to get help straight away (not for threats against others).
    const SUPPORT_REASONS = /self-harm|suicid|disappear|plan or method|abuse|danger|sexual|eating|another student|distress|hopeless|depress|mental health|bullying/i;
    function maybeShowSupport(risk, aboutOther) {
      if (currentRole !== 'student' || !risk) return;
      const serious = risk.critical || risk.level === 'High' || risk.level === 'Medium';
      if (!serious || !(risk.reasons || []).some(r => SUPPORT_REASONS.test(r))) return;
      const friend = aboutOther || (!risk.critical && (risk.reasons || []).some(r => /another student/i.test(r)));
      setTimeout(() => showHelp(friend ? 'friend' : 'after'), 350);
    }

    // ── ANONYMOUS MODE ── needs "Anonymous" switched on in Firebase → Authentication → Sign-in method
    async function handleAnonymousSignIn() {
      if (authBusy) return;
      loginError = ''; authBusy = 'anon'; signInFlowActive = true; render();
      try {
        let user = auth.currentUser && auth.currentUser.isAnonymous ? auth.currentUser : null;
        if (!user) user = (await auth.signInAnonymously()).user;
        enterAnonymous(user);
        addLog('Anonymous session started', 'Anonymous', 'info');
      } catch (e) {
        loginError = friendlyAuthError(e && e.code, e && e.message);
      } finally { authBusy = ''; signInFlowActive = false; render(); }
    }
    function enterAnonymous(user) {
      isAnonymous = true; currentRole = 'student'; isAuthenticated = true;
      currentUserEmail = 'anon_' + user.uid;
      activeSidebarItem = localStorage.getItem('qh_last_page') || 'Dashboard';
      localStorage.setItem('qh_saved_role', 'student');
      loadSeen(); loadDataFromFirestore();
    }

    // ── UNREAD BADGES ── remembered per account on this device
    let _seen = null, _seenTimer = null;
    function loadSeen() {
      try { _seen = JSON.parse(localStorage.getItem('qh_seen_' + currentUserEmail)); } catch (e) { _seen = null; }
      if (!_seen || typeof _seen !== 'object' || !_seen.items) { _seen = { base: Date.now(), items: {} }; saveSeen(); }
    }
    function saveSeen() { try { localStorage.setItem('qh_seen_' + currentUserEmail, JSON.stringify(_seen)); } catch (e) {} }
    function otherActivityTs(item) {
      let t = 0; const iAmStudent = currentRole === 'student';
      (item.chatMessages || []).forEach(m => { const fromStaff = m.role === 'guidance' || !!m.isSystem; if (iAmStudent === fromStaff) t = Math.max(t, Number(m.ts) || 0); });
      if (iAmStudent) t = Math.max(t, Number(item.guidanceMessageTs) || 0, Number(item.meetScheduledAt) || 0);
      else t = Math.max(t, Number(item.timestamp) || 0);
      return t;
    }
    function isUnread(item, kind) {
      if (!_seen || currentRole === 'admin') return false;
      return otherActivityTs(item) > Math.max(_seen.items[kind + item.id] || 0, _seen.base || 0);
    }
    function unreadCount(page) {
      if (page === 'Postings') return postings.filter(p => isUnread(p, 'p')).length;
      if (page === 'Consultations') return consultationPostings.filter(c => isUnread(c, 'c')).length;
      return 0;
    }
    function navBadge(page) { const n = unreadCount(page); return n ? '<span class="nav-badge" aria-label="' + n + ' new">' + (n > 9 ? '9+' : n) + '</span>' : ''; }
    function scheduleMarkSeen() {
      const page = activeSidebarItem;
      if (!isAuthenticated || !_seen || (page !== 'Postings' && page !== 'Consultations') || !unreadCount(page) || _seenTimer || document.hidden) return;
      _seenTimer = setTimeout(() => {
        _seenTimer = null;
        if (activeSidebarItem !== page || !_seen) return;
        const now = Date.now(), kind = page === 'Postings' ? 'p' : 'c';
        (page === 'Postings' ? postings : consultationPostings).forEach(i => { if (isUnread(i, kind)) _seen.items[kind + i.id] = now; });
        const keys = Object.keys(_seen.items); if (keys.length > 600) keys.slice(0, keys.length - 400).forEach(k => delete _seen.items[k]);
        saveSeen(); render();
      }, 4000);
    }

    // ── "SEEN BY A COUNSELOR" ── recorded when a counselor actually has the card on screen
    let _seenObserver = null; const _seenPending = new Map();
    function observeSeenCards() {
      if (currentRole !== 'guidance' || !('IntersectionObserver' in window)) return;
      if (!_seenObserver) _seenObserver = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          const key = en.target.getAttribute('data-unseen'); if (!key) return;
          if (en.isIntersecting && !_seenPending.has(key)) {
            _seenPending.set(key, setTimeout(() => {
              const [col, id] = key.split(':');
              db.collection(col).doc(id).update({ seenAt: Date.now(), seenBy: currentUserEmail }).catch(() => {});
              _seenObserver.unobserve(en.target);
            }, 1500));
          } else if (!en.isIntersecting && _seenPending.has(key)) { clearTimeout(_seenPending.get(key)); _seenPending.delete(key); }
        });
      }, { threshold: 0.4 });
      document.querySelectorAll('[data-unseen]').forEach(el => { if (!el._seenObs) { el._seenObs = true; _seenObserver.observe(el); } });
    }
    function hasCounselorReply(item) { return !!(item.firstReplyAt || item.guidanceMessage || (item.chatMessages || []).some(m => m.role === 'guidance' && !m.isSystem)); }
    function statusChip(item) {
      if (currentRole !== 'student') return '';
      const replied = hasCounselorReply(item), seen = !!item.seenAt || replied;
      const label = replied ? tr('stReplied') : seen ? tr('stSeen') : tr('stSent');
      const icon = replied ? 'check-check' : seen ? 'eye' : 'clock';
      const col = replied ? (darkMode ? '#a5d6a7' : '#2e7d32') : seen ? (darkMode ? '#90caf9' : '#1565c0') : config.text_color + '99';
      return '<span class="status-chip" style="color:' + col + ';border-color:' + (replied || seen ? col : config.text_color + '33') + '"><i data-lucide="' + icon + '" style="width:12px;height:12px"></i>' + label + '</span>';
    }
    function newChip(item, kind) { return isUnread(item, kind) ? '<span class="new-chip">' + tr('isNew') + '</span>' : ''; }

    // ── "COUNSELOR IS TYPING" ── one small write every 6 seconds at most
    const _typingSent = {}; let _typingTimer = null;
    function noteTyping(id) {
      if (currentRole !== 'guidance') return;
      const now = Date.now(); if (now - (_typingSent[id] || 0) < 6000) return;
      _typingSent[id] = now;
      db.collection('consultations').doc(String(id)).update({ guidanceTypingAt: now }).catch(() => {});
    }
    function typingLine(c) {
      if (currentRole !== 'student' || !(Date.now() - (Number(c.guidanceTypingAt) || 0) < 9000)) return '';
      if (!_typingTimer) _typingTimer = setTimeout(() => { _typingTimer = null; render(); }, 3200);
      return '<div class="typing-line">' + tr('typing') + '</div>';
    }

    // ── ASSIGNMENT ──
    async function assignItem(col, id) {
      const list = col === 'postings' ? postings : consultationPostings;
      const item = list.find(x => String(x.id) === String(id)); if (!item) return;
      const mine = item.assignedTo === currentUserEmail;
      try {
        await db.collection(col).doc(String(id)).update(mine ? { assignedTo: firebase.firestore.FieldValue.delete(), assignedAt: firebase.firestore.FieldValue.delete() } : { assignedTo: currentUserEmail, assignedAt: Date.now() });
        toast(mine ? 'Released' : 'Assigned to you', 'success');
      } catch (e) { showModal('Error', _esc(e.message), 'error'); }
    }
    function assignControl(col, item) {
      if (currentRole !== 'guidance') return '';
      const who = String(item.assignedTo || ''), mine = who === currentUserEmail;
      const label = mine ? 'Assigned to you · release' : who ? 'Assigned to ' + _esc(who.split('@')[0]) + ' · take over' : 'Assign to me';
      return '<button onclick="assignItem(\'' + col + '\',\'' + item.id + '\')" class="assign-btn' + (mine ? ' mine' : who ? ' other' : '') + '"><i data-lucide="' + (who ? 'user-check' : 'user-plus') + '" style="width:12px;height:12px"></i>' + label + '</button>';
    }

    // ── COUNSELOR FILTERS ──
    let staffFilter = { risk: 'all', needsReply: false, mine: false, grade: '', q: '' };
    function needsReply(item, kind) {
      if (kind === 'c' && item.status !== 'Pending') return false;
      const last = (item.chatMessages || []).filter(m => !m.isSystem).pop();
      if (last) return last.role !== 'guidance';
      return !item.guidanceMessage;
    }
    function applyStaffFilter(list, kind) {
      if (currentRole !== 'guidance') return list;
      const f = staffFilter, q = (kind === 'c' ? f.q : '').trim().toLowerCase();
      return list.filter(i =>
        (f.risk === 'all' || (f.risk === 'high' ? i.riskLevel === 'High' : (i.riskLevel === 'High' || i.riskLevel === 'Medium'))) &&
        (!f.needsReply || needsReply(i, kind)) &&
        (!f.mine || i.assignedTo === currentUserEmail) &&
        (!f.follow || (i.followUpAt && dayStart(i.followUpAt) <= dayStart(Date.now()))) &&
        (kind !== 'c' || !f.grade || i.gradeLevel === f.grade) &&
        (kind !== 'c' || !f.strand || i.strand === f.strand) &&
        (!q || ((i.reason || '') + ' ' + (i.description || '') + ' ' + (i.author || '')).toLowerCase().includes(q)));
    }
    function filterActive(kind) { const f = staffFilter; return f.risk !== 'all' || f.needsReply || f.mine || f.follow || (kind === 'c' && (f.grade || f.strand || f.q)); }
    function staffFilterBar(kind, shown, total) {
      if (currentRole !== 'guidance') return '';
      const f = staffFilter, c = config;
      const chip = (on, label, js) => '<button aria-pressed="' + on + '" onclick="' + js + ';render()" class="filter-chip' + (on ? ' on' : '') + '">' + label + '</button>';
      return '<div data-key="filters-' + kind + '" class="filter-bar">' +
        (kind === 'c' ? '<div class="flex items-center gap-2 px-3 py-2 rounded-lg" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '22;flex:1 1 220px"><i data-lucide="search" style="width:16px;height:16px;color:' + c.text_color + '88"></i><input type="text" aria-label="Search consultations" placeholder="Search consultations…" value="' + _esc(f.q) + '" oninput="staffFilter.q=this.value;render()" autocomplete="off" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:' + c.text_color + ';font-size:14px" /></div>' : '') +
        '<div class="filter-chips" role="group" aria-label="Filters">' +
        chip(f.risk === 'all' && !f.needsReply && !f.mine && !f.grade && !f.strand && !f.follow, 'All', "staffFilter={risk:'all',needsReply:false,mine:false,grade:'',q:staffFilter.q}") +
        chip(f.risk === 'high', 'High risk', "staffFilter.risk=staffFilter.risk==='high'?'all':'high'") +
        chip(f.risk === 'attention', 'High + Medium', "staffFilter.risk=staffFilter.risk==='attention'?'all':'attention'") +
        chip(f.needsReply, 'Needs reply', 'staffFilter.needsReply=!staffFilter.needsReply') +
        chip(f.mine, 'Assigned to me', 'staffFilter.mine=!staffFilter.mine') +
        chip(!!f.follow, 'Follow-up due', 'staffFilter.follow=!staffFilter.follow') +
        (kind === 'c' ? '<select aria-label="Grade level" onchange="staffFilter.grade=this.value;render()" class="filter-chip' + (f.grade ? ' on' : '') + '">' + [''].concat(GRADES.map(g => 'Grade ' + g)).map(g => '<option value="' + g + '"' + (f.grade === g ? ' selected' : '') + '>' + (g || 'Any grade') + '</option>').join('') + '</select>' +
          '<select aria-label="Strand" onchange="staffFilter.strand=this.value;render()" class="filter-chip' + (f.strand ? ' on' : '') + '">' + [''].concat(STRANDS).map(g => '<option value="' + _esc(g) + '"' + (f.strand === g ? ' selected' : '') + '>' + (_esc(g) || 'Any strand') + '</option>').join('') + '</select>' : '') +
        '</div>' + (filterActive(kind) ? '<div class="text-xs" style="flex-basis:100%;color:' + c.text_color + '99">Showing ' + shown + ' of ' + total + '</div>' : '') + '</div>';
    }

    // ── WAITING TOO LONG ── checked every minute while a counselor has the app open
    const _overdueTold = new Set(); let _overdueTimer = null;
    function overdueItems() {
      if (currentRole !== 'guidance') return [];
      const now = Date.now(), out = [];
      const check = (i, kind) => { const lim = OVERDUE_MIN[i.riskLevel]; if (lim && needsReply(i, kind) && now - (i.timestamp || now) > lim * 60000) out.push({ item: i, kind }); };
      postings.forEach(p => check(p, 'p')); consultationPostings.forEach(c => check(c, 'c'));
      return out;
    }
    function overdueBanner() {
      const od = overdueItems(); if (!od.length) return '';
      const high = od.filter(o => o.item.riskLevel === 'High').length;
      return '<div data-key="overdue" class="overdue-banner" role="alert"><i data-lucide="clock" style="width:18px;height:18px"></i><span><strong>' + od.length + ' ' + (od.length === 1 ? 'item has' : 'items have') + ' waited too long for a reply</strong>' +
        (high ? ' — ' + high + ' high-risk (over ' + OVERDUE_MIN.High + ' min)' : '') + '.</span><button onclick="staffFilter={risk:\'attention\',needsReply:true,mine:false,grade:\'\',q:\'\'};goTo(\'' + (od.some(o => o.kind === 'c') ? 'Consultations' : 'Postings') + '\')">Review</button></div>';
    }
    function startOverdueWatch() {
      clearInterval(_overdueTimer);
      if (currentRole !== 'guidance') return;
      _overdueTimer = setInterval(() => {
        const fresh = overdueItems().filter(o => !_overdueTold.has(o.kind + o.item.id));
        if (!fresh.length) return;
        fresh.forEach(o => _overdueTold.add(o.kind + o.item.id));
        const msg = fresh.length + (fresh.length === 1 ? ' item is' : ' items are') + ' still waiting for a reply';
        toast(msg, 'error');
        try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('QHsafety — reply needed', { body: msg }); } catch (e) {}
        render();
      }, 60000);
    }

    // ── CASE HISTORY ── everything one student has sent, on a single timeline
    function openHistory(kind, id) {
      if (currentRole !== 'guidance') return;
      const src = (kind === 'p' ? postings : consultationPostings).find(x => String(x.id) === String(id)); if (!src) return;
      const who = src.authorId;
      const rows = [];
      postings.filter(p => p.authorId === who).forEach(p => rows.push({ t: p.timestamp, type: 'Posting', title: p.title, body: p.content, risk: p.riskLevel, extra: p.guidanceMessage ? 'Guidance reply: ' + p.guidanceMessage : '' }));
      consultationPostings.filter(c => c.authorId === who).forEach(c => rows.push({ t: c.timestamp, type: 'Consultation', title: c.reason, body: c.description, risk: c.riskLevel,
        extra: [c.status === 'Done' ? 'Resolved' : 'Pending', c.gradeLevel, c.referredTo ? 'Referred to ' + c.referredTo : '', c.guidanceNote ? 'Note: ' + c.guidanceNote : '', c.sessionRating ? 'Rated ' + c.sessionRating + '/5' : ''].filter(Boolean).join(' · ') }));
      rows.sort((a, b) => (b.t || 0) - (a.t || 0));
      const riskCol = (r) => r === 'High' ? '#d32f2f' : r === 'Medium' ? '#e65100' : r === 'Low-Medium' ? '#8d6e00' : '#2e7d32';
      const name = who.startsWith('anon_') ? 'Anonymous student (same device)' : who;
      closeSheet('qh-history');
      const el = document.createElement('div');
      el.id = 'qh-history'; el.className = 'qh-sheet-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'qh-history-title');
      el.innerHTML = '<div class="qh-sheet wide"><div class="qh-sheet-head"><h2 id="qh-history-title">Case history</h2><button class="qh-sheet-x" aria-label="Close" onclick="closeSheet(\'qh-history\')">' + iconSvg('x', ' style="width:18px;height:18px"') + '</button></div>' +
        '<p class="qh-sheet-lead" style="overflow-wrap:anywhere"><strong>' + _esc(name) + '</strong> — ' + rows.length + (rows.length === 1 ? ' item' : ' items') + ', ' + rows.filter(r => r.risk === 'High' || r.risk === 'Medium').length + ' flagged Medium or High. Covers the most recent 150 postings and consultations.</p>' +
        '<div class="qh-timeline">' + rows.map(r => '<div class="qh-tl-row"><div class="qh-tl-dot" style="background:' + riskCol(r.risk) + '"></div><div><div class="qh-tl-meta">' + (r.t ? new Date(r.t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '') + ' · ' + r.type + ' · ' + _esc(r.risk) + ' risk</div><div class="qh-tl-title">' + _esc(r.title) + '</div><div class="qh-tl-body">' + _esc(r.body) + '</div>' + (r.extra ? '<div class="qh-tl-extra">' + _esc(r.extra) + '</div>' : '') + '</div></div>').join('') + '</div>' +
        '<button class="qh-sheet-close" onclick="closeSheet(\'qh-history\')">Close</button></div>';
      el.addEventListener('click', (e) => { if (e.target === el) closeSheet('qh-history'); });
      document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('open'));
      const x = el.querySelector('.qh-sheet-x'); if (x) x.focus();
    }
    function historyLink(kind, item) {
      if (currentRole !== 'guidance') return _esc(item.author);
      return '<button class="link-btn" onclick="openHistory(\'' + kind + '\',\'' + item.id + '\')" title="See everything this student has sent">' + _esc(item.studentEmail || item.author) + '</button>';
    }

    // ── MONTHLY REPORT ──
    let reportMonth = new Date().toISOString().slice(0, 7), reportCache = {};
    function loadReport(month) {
      if (reportCache[month]) return;
      reportCache[month] = { loading: true };
      const [y, m] = month.split('-').map(Number);
      const start = new Date(y, m - 1, 1).getTime(), end = new Date(y, m, 1).getTime();
      const grab = (col, kind) => db.collection(col).where('timestamp', '>=', start).where('timestamp', '<', end).get().then(s => { const out = []; s.forEach(d => { const x = cleanDoc(d.data(), kind); if (x) out.push(x); }); return out; });
      Promise.all([grab('postings', 'posting'), grab('consultations', 'consultation')])
        .then(([p, c]) => { reportCache[month] = { postings: p, consultations: c }; })
        .catch(e => { reportCache[month] = { error: (e && e.message) || 'Could not load' }; })
        .then(render);
    }
    function firstReplyMinutes(i) {
      let t = Number(i.firstReplyAt) || 0;
      if (!t) { const m = (i.chatMessages || []).find(x => x.role === 'guidance' && !x.isSystem); t = (m && Number(m.ts)) || Number(i.guidanceMessageTs) || 0; }
      return t && i.timestamp ? Math.max(0, (t - i.timestamp) / 60000) : null;
    }
    function reportStats(month) {
      const d = reportCache[month]; if (!d || d.loading || d.error) return null;
      const all = d.postings.map(p => ({ ...p, _k: 'Posting' })).concat(d.consultations.map(c => ({ ...c, _k: 'Consultation' })));
      const count = (arr, fn) => { const o = {}; arr.forEach(x => { const k = fn(x); if (k) o[k] = (o[k] || 0) + 1; }); return o; };
      const replies = all.map(firstReplyMinutes).filter(v => v !== null).sort((a, b) => a - b);
      const reasons = {}; all.forEach(i => (i.reasons || []).forEach(r => { const k = r.replace(/\s*\(A4\)/, ''); reasons[k] = (reasons[k] || 0) + 1; }));
      return { all, total: all.length, postings: d.postings.length, consultations: d.consultations.length,
        risk: count(all, x => x.riskLevel), grade: count(all, x => GRADE_RE.test(x.gradeLevel) ? x.gradeLevel : ''), strand: count(all, x => x.strand), age: count(all, x => ageLabel(x.age)), reasons,
        resolved: d.consultations.filter(c => c.status === 'Done').length,
        unanswered: all.filter(i => firstReplyMinutes(i) === null && !hasCounselorReply(i)).length,
        medianReply: replies.length ? replies[Math.floor(replies.length / 2)] : null, replied: replies.length };
    }
    function fmtDuration(min) { if (min === null) return '—'; if (min < 60) return Math.round(min) + ' min'; if (min < 1440) return (min / 60).toFixed(1) + ' h'; return (min / 1440).toFixed(1) + ' days'; }
    function exportReportCsv() {
      const s = reportStats(reportMonth); if (!s) return;
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
      const rows = [['Date', 'Type', 'Risk level', 'AI score', 'Priority', 'Grade', 'Strand', 'Age', 'Status', 'Categories', 'First reply (minutes)', 'Assigned to']];
      s.all.sort((a, b) => a.timestamp - b.timestamp).forEach(i => { const fr = firstReplyMinutes(i); rows.push([new Date(i.timestamp).toISOString().slice(0, 10), i._k, i.riskLevel, i.aiScore, i.priority, i.gradeLevel || '', i.strand || '', ageLabel(i.age), i._k === 'Consultation' ? i.status : '', (i.reasons || []).join('; '), fr === null ? '' : Math.round(fr), i.assignedTo || '']); });
      const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'qhsafety-report-' + reportMonth + '.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Report downloaded (no names or message text included)', 'success');
    }
    function reportBars(title, obj, order, status) {
      const c = config, keys = (order || Object.keys(obj).sort((a, b) => obj[b] - obj[a])).filter(k => obj[k]).slice(0, order ? 20 : 8);
      if (!keys.length) return '';
      const max = Math.max.apply(null, keys.map(k => obj[k]));
      const statusCol = { High: '#d32f2f', Medium: '#e65100', 'Low-Medium': '#b28900', Low: '#2e7d32' };
      return '<div class="p-6 rounded-xl" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><h3 class="font-bold mb-4" style="color:' + c.text_color + '">' + title + '</h3><div class="rep-bars">' +
        keys.map(k => '<div class="rep-row" title="' + _esc(k) + ': ' + obj[k] + '"><span class="rep-label" style="color:' + c.text_color + 'cc">' + _esc(k) + '</span><span class="rep-track"><span class="rep-fill" style="width:' + Math.max(2, obj[k] / max * 100) + '%;background:' + (status ? statusCol[k] : (darkMode ? '#80deea' : '#2c3e50')) + '"></span></span><span class="rep-val" style="color:' + c.text_color + '">' + obj[k] + '</span></div>').join('') + '</div></div>';
    }
    function renderReports(fs) {
      const c = config; loadReport(reportMonth);
      const d = reportCache[reportMonth], s = reportStats(reportMonth);
      const tile = (label, value, sub) => '<div class="p-5 rounded-xl" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><div class="text-xs font-semibold" style="color:' + c.text_color + '99">' + label + '</div><div class="font-bold" style="font-size:28px;line-height:1.2;color:' + c.text_color + '">' + value + '</div>' + (sub ? '<div class="text-xs mt-1" style="color:' + c.text_color + '88">' + sub + '</div>' : '') + '</div>';
      return '<div class="max-w-4xl"><div class="flex items-center justify-between flex-wrap gap-3 mb-6"><h1 class="font-bold hidden md:block" style="font-size:' + fs * 1.4 + 'px;color:' + c.text_color + '">Monthly report</h1>' +
        '<div class="flex gap-2 items-center flex-wrap"><input type="month" aria-label="Month" value="' + _esc(reportMonth) + '" max="' + new Date().toISOString().slice(0, 7) + '" onchange="if(this.value){reportMonth=this.value;render()}" style="padding:8px 10px;border:1px solid ' + c.text_color + '22;border-radius:8px;background:' + c.surface_color + ';color:' + c.text_color + ';font-size:14px" />' +
        (s && s.total ? '<button onclick="exportReportCsv()" class="rep-btn" style="color:' + c.text_color + ';border-color:' + c.text_color + '33"><i data-lucide="download" style="width:14px;height:14px"></i>CSV</button><button onclick="window.print()" class="rep-btn" style="color:' + c.text_color + ';border-color:' + c.text_color + '33"><i data-lucide="printer" style="width:14px;height:14px"></i>Print</button>' : '') + '</div></div>' +
        (!d || d.loading ? '<p style="color:' + c.text_color + '99">' + tr('loading') + '</p>' : d.error ? '<div class="p-4 rounded-lg text-sm" role="alert" style="background:#fdecea;color:#b71c1c">Could not load this month: ' + _esc(d.error) + '</div>' :
        !s.total ? '<div class="p-8 rounded-xl text-center text-sm" style="background:' + c.surface_color + ';border:1px dashed ' + c.text_color + '33;color:' + c.text_color + '99">Nothing was submitted in this month.</div>' :
        '<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 rep-tiles">' + tile('Submissions', s.total, s.postings + ' postings · ' + s.consultations + ' consultations') + tile('Flagged Medium or High', (s.risk.High || 0) + (s.risk.Medium || 0), (s.risk.High || 0) + ' high') + tile('Typical first reply', fmtDuration(s.medianReply), 'median of ' + s.replied + ' replied') + tile('Still unanswered', s.unanswered, s.resolved + ' consultations resolved') + '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + reportBars('By risk level', s.risk, ['High', 'Medium', 'Low-Medium', 'Low'], true) + reportBars('By grade level', s.grade, GRADES.map(g => 'Grade ' + g)) + reportBars('By strand', s.strand, STRANDS) + reportBars('By age', s.age, Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, k) => ageLabel(AGE_MIN + k))) + '</div>' +
        '<div class="mt-4">' + reportBars('Most common concerns', s.reasons) + '</div>' +
        '<p class="text-xs mt-4" style="color:' + c.text_color + '88">Counts only. The CSV has one row per submission with dates, levels and categories — no names and no message text.</p>') + '</div>';
    }

    // ── STORAGE PAGE (admin) ──
    function renderStorage(fs) {
      const c = config, st = storageStats;
      const levelCol = { safe: '#2e7d32', caution: '#b28900', warning: '#e65100', critical: '#d32f2f' };
      return '<div class="max-w-3xl"><div class="flex items-center justify-between flex-wrap gap-3 mb-6"><h1 class="font-bold hidden md:block" style="font-size:' + fs * 1.4 + 'px;color:' + c.text_color + '">Storage</h1>' +
        '<button onclick="scanFirebaseStorage()" ' + (storageLoading ? 'disabled' : '') + ' class="px-5 py-2.5 rounded-lg font-semibold text-sm btn-row" style="background:' + c.primary_action_color + ';color:#2c3e50">' + (storageLoading ? spinner + 'Scanning…' : '<i data-lucide="hard-drive" style="width:16px;height:16px"></i>' + (st ? 'Scan again' : 'Scan now')) + '</button></div>' +
        '<p class="text-sm mb-6" style="color:' + c.text_color + '99">Estimates how much of the free Firestore allowance (1 GB) the app is using. A scan reads every document once, so run it occasionally, not daily.</p>' +
        (!st ? '' : st.error ? '<div class="p-4 rounded-lg text-sm" role="alert" style="background:#fdecea;color:#b71c1c">Scan failed: ' + _esc(st.error) + '</div>' :
        '<div class="p-6 rounded-xl mb-4" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><div class="flex items-center justify-between mb-2"><span class="font-bold" style="color:' + c.text_color + '">' + formatBytes(st.totalBytes) + ' used</span><span class="text-sm font-semibold" style="color:' + levelCol[st.level] + '">' + st.totalPct.toFixed(2) + '% · ' + st.level + '</span></div><div class="rep-track" style="height:10px"><span class="rep-fill" style="width:' + Math.max(1, Math.min(100, st.totalPct)) + '%;background:' + levelCol[st.level] + '"></span></div><div class="text-xs mt-2" style="color:' + c.text_color + '88">Scanned ' + new Date(st.scannedAt).toLocaleString() + '</div></div>' +
        '<div class="space-y-2">' + st.results.map(r => '<div class="p-4 rounded-xl flex items-center justify-between gap-3 flex-wrap" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><div><div class="font-semibold" style="color:' + c.text_color + '">' + _esc(r.label) + '</div><div class="text-xs" style="color:' + c.text_color + '88">' + (r.skipped ? 'Could not be read' : r.docCount + ' documents' + (r.attachmentCount ? ' · ' + r.attachmentCount + ' attachments (' + formatBytes(r.attachmentBytes) + ')' : '')) + '</div></div><div class="font-bold" style="color:' + c.text_color + '">' + formatBytes(r.bytes) + '</div></div>').join('') + '</div>') + '</div>';
    }

    // ── AUTO-LOGOUT WHEN IDLE ── shared computers are common; a session left open exposes private posts
    let _lastActive = Date.now(), _idleWarned = false;
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { _lastActive = Date.now(); }, { capture: true, passive: true }));
    function stayActive() { _lastActive = Date.now(); _idleWarned = false; closeModal(); }
    setInterval(() => {
      if (!isAuthenticated) { _idleWarned = false; return; }
      const limit = (IDLE_LIMIT_MIN[currentRole] || 15) * 60000, idle = Date.now() - _lastActive;
      if (idle >= limit) {
        _idleWarned = false; closeModal(); closeSheet('qh-history');
        logout(); loginError = tr('idleOut'); render();
      } else if (idle >= limit - 60000 && !_idleWarned) {
        _idleWarned = true;
        _openModal(tr('idleTitle'), tr('idleBody'), 'info', { buttons: '<button class="qh-modal-btn qh-modal-btn-success" data-autofocus onclick="stayActive()">' + tr('idleStay') + '</button>' });
      }
    }, 5000);

    // ── LIGHTER ATTACHMENTS ── photos are resized in the browser before they are stored
    const ATTACH_TARGET_BYTES = 230 * 1024;      // per stored image (a Firestore document cannot exceed 1 MB in total)
    const ATTACH_DOC_MAX_BYTES = 450 * 1024;     // PDFs / Word files cannot be shrunk, so they must already be small
    const ATTACH_IMAGE_INPUT_MAX = 12 * 1024 * 1024;
    function readAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('Could not read that file.')); r.readAsDataURL(file); }); }
    async function compressImage(file) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be opened.')); i.src = url; });
        let side = 1280, quality = 0.82, out = '';
        for (let attempt = 0; attempt < 6; attempt++) {
          const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.naturalWidth * scale)); cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
          out = cv.toDataURL('image/jpeg', quality);
          if (out.length * 0.75 <= ATTACH_TARGET_BYTES) break;
          if (quality > 0.6) quality -= 0.12; else side = Math.round(side * 0.75);
        }
        return out;
      } finally { URL.revokeObjectURL(url); }
    }

    // ═══════════════════════════ FEATURES ADDED IN v10 ═══════════════════════════

    // ── Edit these for your school ──
    const SCHOOL_HOURS = { days: [1, 2, 3, 4, 5], open: 7, close: 17, timeZone: 'Asia/Manila',
      label: { en: 'Monday to Friday, 7 AM – 5 PM', tl: 'Lunes hanggang Biyernes, 7 AM – 5 PM' } };
    const DEFAULT_TEMPLATES = [
      { title: 'First reply — serious concern', text: 'Thank you for trusting us with this. I have read your message and I want to talk with you today. Are you safe right now? Please come to the Guidance Office as soon as you can, or reply here and I will come to you.' },
      { title: 'First reply — general', text: 'Thank you for reaching out. I have read your message and I am here to help. Can you tell me a little more about what has been happening?' },
      { title: 'Set a time to talk', text: 'I would like to talk with you in person. When are you free today or tomorrow? You can also pick one of my open times in this consultation.' },
      { title: 'Report about a friend', text: 'Thank you for looking out for your friend — telling us was the right thing to do. We will reach out to them carefully and we will not say who told us.' },
      { title: 'Checking in', text: 'Hi, I am checking in to see how you have been since we last talked. How are things going?' },
    ];

    Object.assign(T.en, {
      library:'Library', libIntro:'Short guides you can read any time. They are general advice, not a replacement for talking to someone.',
      libTalk:'Want to talk to a person?', announcements:'Announcements', noAnnouncements:'No announcements yet.',
      afterHours:'Counselors reply during school hours', afterHoursBody:'It is outside school hours now, so a reply may come on the next school day. If this cannot wait, use Get help now.',
      moodTitle:'How are you today?', moodSaved:'Saved for today', moodPrivate:'Only you can see this. It stays on this device.',
      moodLow:'It looks like the last few days have been hard. You do not have to carry it alone.', moodAsk:'Request a consultation',
      pickTime:'Pick a time to meet', noSlots:'No open times right now — message the counselor in the chat.', booked:'Time booked', slotTaken:'That time was just taken. Please pick another.',
      install:'Install the app', installBody:'Add QHsafety to your home screen so it opens like an app.', installBtn:'Install', installIos:'On iPhone: tap the Share button, then "Add to Home Screen".', installed:'QHsafety is installed on this device.',
    });
    Object.assign(T.tl, {
      library:'Aklatan', libIntro:'Maiikling gabay na mababasa mo anumang oras. Pangkalahatang payo ito, hindi kapalit ng pakikipag-usap sa tao.',
      libTalk:'Gusto mo bang makipag-usap sa tao?', announcements:'Mga Anunsyo', noAnnouncements:'Wala pang anunsyo.',
      afterHours:'Sumasagot ang mga counselor tuwing oras ng klase', afterHoursBody:'Tapos na ang oras ng klase ngayon, kaya maaaring sa susunod na araw ng pasok ka masagot. Kung hindi ito makapaghihintay, pindutin ang Humingi ng tulong ngayon.',
      moodTitle:'Kumusta ka ngayon?', moodSaved:'Na-save para sa araw na ito', moodPrivate:'Ikaw lang ang nakakakita nito. Nasa device na ito lang.',
      moodLow:'Mukhang mahirap ang mga nakaraang araw. Hindi mo kailangang mag-isa.', moodAsk:'Humiling ng konsultasyon',
      pickTime:'Pumili ng oras ng pagkikita', noSlots:'Walang bakanteng oras ngayon — mag-mensahe sa counselor sa chat.', booked:'Na-book na ang oras', slotTaken:'May nauna na sa oras na iyon. Pumili ng iba.',
      install:'I-install ang app', installBody:'Idagdag ang QHsafety sa home screen para bumukas na parang app.', installBtn:'I-install', installIos:'Sa iPhone: pindutin ang Share, tapos "Add to Home Screen".', installed:'Naka-install na ang QHsafety sa device na ito.',
    });

    // ── AFTER-HOURS NOTICE ──
    function isAfterHours() {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_HOURS.timeZone, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
        const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.find(p => p.type === 'weekday').value];
        const h = Number(parts.find(p => p.type === 'hour').value) % 24;
        return !(SCHOOL_HOURS.days.includes(wd) && h >= SCHOOL_HOURS.open && h < SCHOOL_HOURS.close);
      } catch (e) { return false; }
    }
    function afterHoursNote() {
      if (currentRole !== 'student' || !isAfterHours()) return '';
      return '<div class="after-hours" role="note"><i data-lucide="clock" style="width:16px;height:16px"></i><div><strong>' + tr('afterHours') + ' (' + (SCHOOL_HOURS.label[appLang] || SCHOOL_HOURS.label.en) + ').</strong> ' + tr('afterHoursBody') + ' <button class="link-btn" onclick="showHelp()">' + tr('getHelp') + '</button></div></div>';
    }

    // ── FOLLOW-UP REMINDERS ──
    function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
    async function setFollowUp(col, id, days) {
      days = Number(days);
      const del = firebase.firestore.FieldValue.delete();
      try {
        await db.collection(col).doc(String(id)).update(days > 0 ? { followUpAt: dayStart(Date.now() + days * 86400000), followUpBy: currentUserEmail } : { followUpAt: del, followUpBy: del });
        toast(days > 0 ? 'Follow-up set' : 'Follow-up cleared', 'success');
      } catch (e) { showModal('Error', _esc(e.message), 'error'); }
    }
    function followLabel(ts) {
      const diff = Math.round((dayStart(ts) - dayStart(Date.now())) / 86400000);
      return diff < 0 ? 'Follow-up overdue' : diff === 0 ? 'Follow up today' : diff === 1 ? 'Follow up tomorrow' : 'Follow up ' + new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    function followControl(col, item) {
      if (currentRole !== 'guidance') return '';
      const has = Number(item.followUpAt) > 0, due = has && dayStart(item.followUpAt) <= dayStart(Date.now());
      return '<select aria-label="Follow-up reminder" class="assign-btn' + (due ? ' due' : has ? ' other' : '') + '" onchange="setFollowUp(\'' + col + '\',\'' + item.id + '\',this.value)">' +
        '<option value="" selected>' + (has ? followLabel(item.followUpAt) : 'Remind me to follow up') + '</option><option value="1">Tomorrow</option><option value="3">In 3 days</option><option value="7">In a week</option><option value="14">In 2 weeks</option>' + (has ? '<option value="0">Clear reminder</option>' : '') + '</select>';
    }
    function followUpsDue() {
      if (currentRole !== 'guidance') return [];
      const today = dayStart(Date.now()), out = [];
      postings.forEach(p => { if (p.followUpAt && dayStart(p.followUpAt) <= today) out.push({ item: p, col: 'postings', page: 'Postings', title: p.title }); });
      consultationPostings.forEach(c => { if (c.followUpAt && dayStart(c.followUpAt) <= today) out.push({ item: c, col: 'consultations', page: 'Consultations', title: c.reason }); });
      return out.sort((a, b) => a.item.followUpAt - b.item.followUpAt);
    }
    function followUpPanel() {
      const due = followUpsDue(); if (!due.length) return '';
      const c = config;
      return '<div data-key="followups" class="p-6 rounded-xl mb-6" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><div class="flex items-center gap-2 mb-3"><i data-lucide="calendar-clock" style="width:18px;height:18px;color:' + c.text_color + '"></i><h3 class="font-bold" style="color:' + c.text_color + '">Follow-ups due (' + due.length + ')</h3></div><div class="space-y-2">' +
        due.map(d => '<div class="flex items-center justify-between gap-3 flex-wrap p-3 rounded-lg" style="background:' + c.text_color + '08"><div style="min-width:0;flex:1 1 180px"><div class="font-semibold text-sm" style="color:' + c.text_color + ';overflow-wrap:anywhere">' + _esc(d.title) + '</div><div class="text-xs" style="color:' + c.text_color + '99">' + _esc(d.item.author) + ' · ' + followLabel(d.item.followUpAt) + '</div></div><div class="flex gap-2"><button class="text-xs px-3 py-1.5 rounded-lg font-semibold" style="background:' + c.text_color + '14;color:' + c.text_color + '" onclick="staffFilter={risk:\'all\',needsReply:false,mine:false,grade:\'\',q:\'\',follow:true};goTo(\'' + d.page + '\')">Open</button><button class="text-xs px-3 py-1.5 rounded-lg font-semibold" style="background:' + c.secondary_action_color + ';color:#2c3e50" onclick="setFollowUp(\'' + d.col + '\',\'' + d.item.id + '\',0)">Done</button></div></div>').join('') + '</div></div>';
    }

    // ── SAVED REPLIES ── shared by all counselors (stored in Firestore under counselors/_templates)
    let replyTemplates = null;
    function templateList() { return replyTemplates && replyTemplates.length ? replyTemplates : DEFAULT_TEMPLATES; }
    function templatePicker(kind, id) {
      if (currentRole !== 'guidance') return '';
      return '<select aria-label="Saved replies" class="assign-btn" style="max-width:100%" onchange="useTemplate(\'' + kind + '\',\'' + id + '\',this.value);this.selectedIndex=0"><option value="" selected>Saved replies…</option>' +
        templateList().map((t, i) => '<option value="' + i + '">' + _esc(t.title) + '</option>').join('') + '</select>';
    }
    function useTemplate(kind, id, idx) {
      const t = templateList()[Number(idx)]; if (!t || idx === '') return;
      const store = kind === 'p' ? guidanceMessageDraft : consultationChatDraft;
      const el = document.getElementById((kind === 'p' ? 'gmsg_' : 'consultChat_') + id);
      const cur = (el && el.value) || store[id] || '';
      const text = (cur.trim() ? cur.trim() + ' ' : '') + t.text;
      store[id] = text.slice(0, kind === 'p' ? 2000 : 1000);
      if (el) { el.value = store[id]; el.focus(); }
    }
    let templatesEditing = null;   // working copy while the Settings editor is open
    function editTemplates() { templatesEditing = templateList().map(t => ({ title: t.title, text: t.text })); render(); }
    function readTemplateInputs() {
      if (!templatesEditing) return;
      templatesEditing = templatesEditing.map((t, i) => ({ title: (document.getElementById('tplTitle_' + i) || {}).value || '', text: (document.getElementById('tplText_' + i) || {}).value || '' }));
    }
    async function saveTemplates() {
      readTemplateInputs();
      const items = templatesEditing.map(t => ({ title: t.title.trim().slice(0, 60), text: t.text.trim().slice(0, 900) })).filter(t => t.title && t.text).slice(0, 20);
      if (items.some(t => containsProfanity(t.text))) { showModal('Please rephrase', LANGUAGE_REFUSAL, 'error'); return; }
      try {
        await db.collection('counselors').doc('_templates').set({ items, updatedAt: Date.now(), updatedBy: currentUserEmail });
        replyTemplates = items; templatesEditing = null; render(); toast('Saved replies updated', 'success');
      } catch (e) { showModal('Error', _esc(e.message), 'error'); }
    }
    function templatesCard() {
      if (currentRole !== 'guidance') return '';
      const c = config, f = 'width:100%;padding:8px 10px;border:1px solid ' + c.text_color + '22;border-radius:8px;background:' + c.background_color + ';color:' + c.text_color + ';font-size:14px';
      return '<div data-key="tpl-card" class="p-6 rounded-xl mb-6" style="background:' + c.surface_color + '"><div class="flex items-center gap-3 mb-2"><i data-lucide="message-square-plus" style="width:20px;height:20px;color:' + c.text_color + '"></i><h3 class="font-bold" style="color:' + c.text_color + '">Saved replies</h3></div>' +
        '<p class="text-sm mb-4" style="color:' + c.text_color + '99">Ready-made first replies, shared by all counselors. Pick one from "Saved replies…" under any reply box, then personalise it before sending.</p>' +
        (!templatesEditing ? '<ul class="text-sm mb-4" style="color:' + c.text_color + 'cc;list-style:disc;padding-left:18px;line-height:1.8">' + templateList().map(t => '<li>' + _esc(t.title) + '</li>').join('') + '</ul><button onclick="editTemplates()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:' + c.text_color + '14;color:' + c.text_color + '">Edit saved replies</button>' :
        templatesEditing.map((t, i) => '<div class="mb-3 p-3 rounded-lg" style="background:' + c.text_color + '08"><input data-keep id="tplTitle_' + i + '" aria-label="Title" maxlength="60" placeholder="Title" value="' + _esc(t.title) + '" style="' + f + ';font-weight:600;margin-bottom:6px" /><textarea data-keep id="tplText_' + i + '" aria-label="Reply text" maxlength="900" rows="3" placeholder="Reply text" style="' + f + ';resize:vertical">' + _esc(t.text) + '</textarea><button class="btn-danger-ghost" style="margin-top:6px" onclick="readTemplateInputs();templatesEditing.splice(' + i + ',1);render()">Remove</button></div>').join('') +
        '<div class="flex gap-2 flex-wrap"><button onclick="readTemplateInputs();templatesEditing.push({title:\'\',text:\'\'});render()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:' + c.text_color + '14;color:' + c.text_color + '">Add a reply</button><button onclick="saveTemplates()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:' + c.primary_action_color + ';color:#2c3e50">Save</button><button onclick="templatesEditing=null;render()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:transparent;color:' + c.text_color + 'aa;border:1px solid ' + c.text_color + '22">Cancel</button></div>') + '</div>';
    }

    // ── INSTALL AS AN APP ──
    let _installEvt = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _installEvt = e; if (isAuthenticated) scheduleRender(); });
    window.addEventListener('appinstalled', () => { _installEvt = null; toast('QHsafety installed', 'success'); scheduleRender(); });
    function isStandalone() { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; } }
    async function installApp() { if (!_installEvt) return; _installEvt.prompt(); try { await _installEvt.userChoice; } catch (e) {} _installEvt = null; render(); }
    function installCard() {
      const c = config, ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
      if (!isStandalone() && !_installEvt && !ios) return '';
      return '<div data-key="install-card" class="p-6 rounded-xl mb-6" style="background:' + c.surface_color + '"><div class="flex items-center gap-3 mb-2"><i data-lucide="smartphone" style="width:20px;height:20px;color:' + c.text_color + '"></i><h3 class="font-bold" style="color:' + c.text_color + '">' + tr('install') + '</h3></div>' +
        (isStandalone() ? '<p class="text-sm" style="color:' + c.text_color + '99">' + tr('installed') + '</p>' :
          '<p class="text-sm mb-4" style="color:' + c.text_color + '99">' + tr('installBody') + (ios && !_installEvt ? ' ' + tr('installIos') : '') + '</p>' + (_installEvt ? '<button onclick="installApp()" class="px-5 py-2.5 rounded-lg font-semibold text-sm" style="background:' + c.primary_action_color + ';color:#2c3e50">' + tr('installBtn') + '</button>' : '')) + '</div>';
    }

    // ── SELF-HELP LIBRARY ── general guidance; have your counselors review and edit before launch
    const LIBRARY = [
      { id: 'stress', icon: 'book-open', title: { en: 'When school feels like too much', tl: 'Kapag sobra na ang bigat ng pag-aaral' },
        points: { en: ['Write down everything that is due, then pick only the next one. A list you can see is lighter than a list in your head.', 'Work in short blocks — 25 minutes on, 5 minutes off. Stand up and drink water in the break.', 'Sleep is part of studying. Staying up all night makes the next day harder, not easier.', 'Tell a teacher early if you are falling behind. Asking for more time before a deadline goes better than explaining after it.', 'If the worry will not switch off for days, talk to a counselor. That is what this app is for.'],
                  tl: ['Isulat lahat ng dapat ipasa, tapos piliin lang ang susunod. Mas magaan ang listahang nakikita kaysa nasa isip lang.', 'Mag-aral nang maiikling bahagi — 25 minuto, pahinga ng 5. Tumayo at uminom ng tubig sa pahinga.', 'Bahagi ng pag-aaral ang tulog. Mas hihirap ang susunod na araw kapag nagpuyat ka buong gabi.', 'Sabihin agad sa guro kung nahuhuli ka na. Mas maayos humingi ng dagdag na oras bago ang deadline kaysa magpaliwanag pagkatapos.', 'Kung ilang araw nang hindi nawawala ang pag-aalala, makipag-usap sa counselor. Para doon ang app na ito.'] } },
      { id: 'bullying', icon: 'shield', title: { en: 'If someone is bullying you', tl: 'Kung may nambu-bully sa iyo' },
        points: { en: ['It is not your fault, and you do not have to handle it alone.', 'Keep proof if it is online: screenshots with dates. Do not reply in anger — save it and report it.', 'Tell an adult you trust: a teacher, a counselor, a parent. You can post here, even without your name.', 'Stay near friends or staff in the places where it usually happens.', 'If anyone hurts you physically or threatens you, report it the same day.'],
                  tl: ['Hindi mo ito kasalanan, at hindi mo kailangang harapin nang mag-isa.', 'Mag-ipon ng patunay kung online: mga screenshot na may petsa. Huwag sumagot nang galit — i-save at i-report.', 'Sabihin sa nakatatandang pinagkakatiwalaan mo: guro, counselor, magulang. Puwede kang mag-post dito kahit walang pangalan.', 'Manatiling malapit sa mga kaibigan o guro sa mga lugar na madalas itong mangyari.', 'Kung may nanakit o nagbanta sa iyo, i-report sa mismong araw na iyon.'] } },
      { id: 'friend', icon: 'heart', title: { en: 'When you are worried about a friend', tl: 'Kapag nag-aalala ka sa kaibigan' },
        points: { en: ['Ask them directly and kindly: "You have not seemed okay lately. What is going on?"', 'Listen more than you talk. You do not need to fix it.', 'If they talk about hurting themselves or not wanting to live, take it seriously every time.', 'Do not promise to keep it secret. Say: "I care about you too much to keep this to myself."', 'Tell a counselor today — use "About someone else" when you post. You will not get them in trouble.'],
                  tl: ['Tanungin sila nang direkta at may malasakit: "Parang hindi ka okay nitong mga araw. Ano ang nangyayari?"', 'Mas makinig kaysa magsalita. Hindi mo kailangang ayusin ito.', 'Kung nabanggit nilang sasaktan ang sarili o ayaw nang mabuhay, seryosohin ito palagi.', 'Huwag mangakong ililihim mo ito. Sabihin: "Masyado kitang mahal para sarilinin ko lang ito."', 'Sabihin sa counselor ngayong araw — piliin ang "Tungkol sa ibang tao" kapag nag-post. Hindi mo sila ipapahamak.'] } },
      { id: 'sad', icon: 'smile', title: { en: 'When you feel low for days', tl: 'Kapag ilang araw ka nang malungkot' },
        points: { en: ['Feeling sad, empty or tired for a long time is common, and it can get better with support.', 'Keep the basics going even when you do not feel like it: eat, sleep, step outside for a few minutes.', 'Tell one person how you really are. Saying it out loud often makes it smaller.', 'Notice what helps even a little — music, a walk, a friend — and do more of that.', 'If you ever think about hurting yourself or ending your life, tell someone now and use Get help now. You deserve help.'],
                  tl: ['Karaniwan ang matagal na lungkot, pagkahungkag o pagod, at puwede itong gumaan kapag may suporta.', 'Ituloy ang mga pangunahing bagay kahit wala kang gana: kumain, matulog, lumabas kahit ilang minuto.', 'Sabihin sa isang tao ang totoo mong nararamdaman. Madalas lumiliit ito kapag nasabi nang malakas.', 'Pansinin ang nakakatulong kahit kaunti — musika, paglalakad, kaibigan — at dagdagan pa iyon.', 'Kung maisip mong saktan ang sarili o tapusin ang buhay mo, sabihin agad sa iba at pindutin ang Humingi ng tulong ngayon. Karapat-dapat kang tulungan.'] } },
      { id: 'home', icon: 'users', title: { en: 'When things are hard at home', tl: 'Kapag mahirap ang sitwasyon sa bahay' },
        points: { en: ['Arguments, money problems or a parent working far away can weigh on you. It is okay to say it is hard.', 'Find one steady adult outside the house: a relative, a teacher, a counselor.', 'If you are being hurt, touched in a way that feels wrong, or you are afraid to go home, tell a counselor. It is never your fault.', 'You can call the Makabata Helpline (1383) about any harm to a child, including yourself.', 'If you are in danger right now, call 911.'],
                  tl: ['Mabigat ang away, problema sa pera o magulang na nasa malayo. Ayos lang sabihing mahirap.', 'Humanap ng isang maaasahang nakatatanda sa labas ng bahay: kamag-anak, guro, counselor.', 'Kung sinasaktan ka, hinahawakan sa paraang mali ang pakiramdam, o takot kang umuwi, sabihin sa counselor. Hindi mo ito kasalanan kailanman.', 'Puwede kang tumawag sa Makabata Helpline (1383) tungkol sa anumang pananakit sa bata, kasama ka.', 'Kung nasa panganib ka ngayon, tumawag sa 911.'] } },
      { id: 'online', icon: 'lock', title: { en: 'Staying safe online', tl: 'Pag-iingat online' },
        points: { en: ['Never send photos of your body to anyone, even someone you trust. Once sent, you cannot take them back.', 'If someone threatens to share your photos or asks for money, do not pay and do not send more. Screenshot, block, and tell an adult.', 'This is a crime against you. You will not be in trouble for reporting it.', 'Keep accounts private and do not share passwords, even with friends.', 'If an adult you met online asks to meet or to keep secrets, tell a counselor.'],
                  tl: ['Huwag magpadala ng litrato ng iyong katawan kahit kanino, kahit pinagkakatiwalaan mo. Hindi na ito mababawi kapag naipadala.', 'Kung may nagbabantang ikalat ang litrato mo o humihingi ng pera, huwag magbayad at huwag nang magpadala. Mag-screenshot, i-block, at sabihin sa nakatatanda.', 'Krimen ito laban sa iyo. Hindi ka mapapahamak sa pagre-report.', 'Gawing private ang mga account at huwag ibigay ang password, kahit sa kaibigan.', 'Kung may nakatatandang nakilala mo online na gustong makipagkita o maglihim, sabihin sa counselor.'] } },
    ];
    function renderLibrary(fs) {
      const c = config, L = (o) => o[appLang] || o.en;
      return '<div class="max-w-3xl"><p class="mb-6 text-sm" style="color:' + c.text_color + '99">' + tr('libIntro') + '</p><div class="space-y-2">' +
        LIBRARY.map(a => '<details data-key="lib-' + a.id + '" class="lib-item" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><summary><span class="lib-icon" style="background:' + c.primary_action_color + '33;color:' + c.text_color + '"><i data-lucide="' + a.icon + '" style="width:18px;height:18px"></i></span><span style="flex:1;font-weight:700;color:' + c.text_color + '">' + _esc(L(a.title)) + '</span><i data-lucide="chevron-down" class="lib-chev" style="width:18px;height:18px;color:' + c.text_color + '88"></i></summary><ul style="color:' + c.text_color + 'cc">' + L(a.points).map(p => '<li>' + _esc(p) + '</li>').join('') + '</ul></details>').join('') +
        '</div><div class="p-6 rounded-xl mt-6" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><h3 class="font-bold mb-3" style="color:' + c.text_color + '">' + tr('libTalk') + '</h3><div class="flex gap-2 flex-wrap"><button onclick="showConsultationForm=true;goTo(\'Consultations\')" class="px-5 py-2.5 rounded-lg font-semibold text-sm" style="background:' + c.primary_action_color + ';color:#2c3e50">' + tr('newConsultation') + '</button><button onclick="showHelp()" class="px-5 py-2.5 rounded-lg font-semibold text-sm" style="background:transparent;color:' + c.text_color + ';border:1px solid ' + c.text_color + '33">' + tr('getHelp') + '</button></div></div></div>';
    }

    // ── MOOD CHECK-IN ── private: kept in this browser only, never sent anywhere
    function todayKey(offset) { const d = new Date(Date.now() - (offset || 0) * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function moodLog() { try { return JSON.parse(localStorage.getItem('qh_mood_' + currentUserEmail)) || {}; } catch (e) { return {}; } }
    function setMood(n) {
      const log = moodLog(); log[todayKey()] = n;
      Object.keys(log).sort().slice(0, -60).forEach(k => delete log[k]);
      try { localStorage.setItem('qh_mood_' + currentUserEmail, JSON.stringify(log)); } catch (e) {}
      render();
    }
    function moodCard() {
      if (currentRole !== 'student') return '';
      const c = config, log = moodLog(), today = log[todayKey()] || 0, faces = ['😞', '😕', '😐', '🙂', '😊'], names = trList('moods');
      const lowRun = [0, 1, 2].every(i => log[todayKey(i)] && log[todayKey(i)] <= 2);
      return '<div data-key="mood-card" class="p-6 rounded-xl mb-6" style="background:' + c.surface_color + '"><h3 class="font-bold mb-3" style="color:' + c.text_color + '">' + tr('moodTitle') + '</h3>' +
        '<div style="display:flex;justify-content:space-between;max-width:320px">' + faces.map((f, i) => '<button onclick="setMood(' + (i + 1) + ')" aria-label="' + _esc(names[i] || '') + '" aria-pressed="' + (today === i + 1) + '" style="flex:1 1 0;min-width:0;font-size:28px;line-height:1;padding:8px 2px;border-radius:12px;background:' + (today === i + 1 ? c.primary_action_color + '55' : 'transparent') + ';opacity:' + (!today || today === i + 1 ? '1' : '.45') + '">' + f + '</button>').join('') + '</div>' +
        '<div class="mood-strip" aria-hidden="true">' + [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(i => { const v = log[todayKey(i)]; return '<span title="' + todayKey(i) + '" style="height:' + (v ? 6 + v * 5 : 4) + 'px;background:' + (v ? (v <= 2 ? '#90a4ae' : v === 3 ? '#80deea' : '#fbc02d') : c.text_color + '22') + '"></span>'; }).join('') + '</div>' +
        '<p class="text-xs mt-2" style="color:' + c.text_color + '88">' + (today ? tr('moodSaved') + ' · ' : '') + tr('moodPrivate') + '</p>' +
        (lowRun ? '<div class="mt-4 p-3 rounded-lg text-sm" style="background:#e3f2fd;color:#0d47a1">' + tr('moodLow') + ' <button class="link-btn" style="font-weight:700" onclick="showConsultationForm=true;goTo(\'Consultations\')">' + tr('moodAsk') + '</button> · <button class="link-btn" style="font-weight:700" onclick="showHelp()">' + tr('getHelp') + '</button></div>' : '') + '</div>';
    }

    // ── APPOINTMENT SLOTS ── counselors publish open times; students book one from their consultation
    let slots = [], slotDraft = { date: '', time: '' };
    function slotLabel(ts) { return new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    async function addSlot() {
      const d = slotDraft; if (!d.date || !d.time) { showModal('Missing info', 'Pick a date and a time.', 'error'); return; }
      const start = new Date(d.date + 'T' + d.time).getTime();
      if (isNaN(start) || start < Date.now()) { showModal('Check the time', 'Choose a time in the future.', 'error'); return; }
      if (slots.some(s => s.counselor === currentUserEmail && s.start === start)) { showModal('Already listed', 'You already have that time open.', 'info'); return; }
      const id = newDocId();
      try { await db.collection('slots').doc(String(id)).set({ id, start, date: d.date, time: d.time, counselor: currentUserEmail, takenBy: '', consultId: '', createdAt: Date.now() }); slotDraft = { date: d.date, time: '' }; render(); toast('Open time added', 'success'); }
      catch (e) { showModal('Error', _esc(e.message), 'error'); }
    }
    async function removeSlot(id) { try { await db.collection('slots').doc(String(id)).delete(); toast('Removed'); } catch (e) { showModal('Error', _esc(e.message), 'error'); } }
    function openSlots() { const now = Date.now(); return slots.filter(s => !s.takenBy && s.start > now).sort((a, b) => a.start - b.start); }
    async function bookSlot(consultId, slotId) {
      const consult = consultationPostings.find(c => String(c.id) === String(consultId)); if (!consult) return;
      const ref = db.collection('slots').doc(String(slotId));
      try {
        const slot = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data().takenBy) throw new Error('taken');
          tx.update(ref, { takenBy: currentUserEmail, consultId: String(consultId), takenAt: Date.now() });
          return snap.data();
        });
        const sysMsg = { sender: currentUserEmail, role: 'guidance', isSystem: true, text: '📅 <strong>Time booked:</strong> ' + _esc(slotLabel(slot.start)) + ' with the guidance counselor.', time: nowTime(), ts: Date.now() };
        await db.collection('consultations').doc(String(consultId)).update({ meetDate: slot.date, meetTime: slot.time, meetDateTime: slot.date + 'T' + slot.time, meetScheduledBy: slot.counselor, meetScheduledAt: Date.now(), slotId: String(slotId), assignedTo: consult.assignedTo || slot.counselor, chatMessages: arrayUnion(sysMsg) });
        toast(tr('booked'), 'success');
      } catch (e) { if (e && e.message === 'taken') showModal(tr('pickTime'), tr('slotTaken'), 'warning'); else showModal('Error', _esc((e && e.message) || 'Could not book'), 'error'); }
    }
    function slotPicker(c) {
      if (currentRole !== 'student' || c.status !== 'Pending' || c.meetDateTime) return '';
      const open = openSlots().slice(0, 6), cf = config;
      return '<div class="mb-3 p-3 rounded-xl" style="background:' + cf.text_color + '07;border:1px solid ' + cf.text_color + '11"><div class="text-xs font-bold mb-2" style="color:' + cf.text_color + 'aa">' + tr('pickTime') + '</div>' +
        (open.length ? '<div class="flex gap-2 flex-wrap">' + open.map(s => '<button class="slot-btn" style="color:' + cf.text_color + ';border-color:' + cf.text_color + '33" onclick="bookSlot(\'' + c.id + '\',\'' + s.id + '\')"><i data-lucide="calendar-plus" style="width:13px;height:13px"></i>' + _esc(slotLabel(s.start)) + '</button>').join('') + '</div>' : '<div class="text-xs" style="color:' + cf.text_color + '88">' + tr('noSlots') + '</div>') + '</div>';
    }
    function slotPanel() {
      if (currentRole !== 'guidance') return '';
      const c = config, mine = slots.filter(s => s.counselor === currentUserEmail && s.start > Date.now() - 3600000).sort((a, b) => a.start - b.start);
      const f = 'padding:8px;border:1px solid ' + c.text_color + '22;border-radius:8px;background:' + c.background_color + ';color:' + c.text_color + ';font-size:13px';
      return '<details data-key="slot-panel" class="lib-item mb-4" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11"><summary><span class="lib-icon" style="background:' + c.secondary_action_color + '44;color:' + c.text_color + '"><i data-lucide="calendar-plus" style="width:18px;height:18px"></i></span><span style="flex:1;font-weight:700;color:' + c.text_color + '">My open times <span style="font-weight:500;color:' + c.text_color + '88">(' + mine.filter(s => !s.takenBy).length + ' open, ' + mine.filter(s => s.takenBy).length + ' booked)</span></span><i data-lucide="chevron-down" class="lib-chev" style="width:18px;height:18px;color:' + c.text_color + '88"></i></summary><div style="padding:0 16px 16px">' +
        '<p class="text-xs mb-3" style="color:' + c.text_color + '99">Students with a pending consultation can book any open time. Booking fills in the meeting on their consultation.</p>' +
        '<div class="flex gap-2 flex-wrap mb-3"><input type="date" aria-label="Date" value="' + _esc(slotDraft.date) + '" min="' + todayKey() + '" oninput="slotDraft.date=this.value" style="' + f + '" /><input type="time" aria-label="Time" value="' + _esc(slotDraft.time) + '" oninput="slotDraft.time=this.value" style="' + f + '" /><button onclick="addSlot()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:' + c.primary_action_color + ';color:#2c3e50">Add time</button></div>' +
        (mine.length ? '<div class="space-y-2">' + mine.map(s => '<div class="flex items-center justify-between gap-2 p-2 rounded-lg text-sm" style="background:' + c.text_color + '08;color:' + c.text_color + '"><span>' + _esc(slotLabel(s.start)) + (s.takenBy ? ' — <strong>booked</strong> by ' + _esc(String(s.takenBy).startsWith('anon_') ? 'an anonymous student' : s.takenBy) : '') + '</span><button class="btn-danger-ghost" onclick="removeSlot(\'' + s.id + '\')">Remove</button></div>').join('') + '</div>' : '<div class="text-xs" style="color:' + c.text_color + '88">No open times yet.</div>') + '</div></details>';
    }

    // ── ANNOUNCEMENTS BOARD ──
    let announcements = [];
    async function deleteAnnouncement(id) {
      const ok = await confirmModal('Delete announcement', 'Remove this announcement from the board? Students will no longer see it.', 'warning'); if (!ok) return;
      try { await db.collection('announcements').doc(String(id)).delete(); toast('Announcement removed'); } catch (e) { showModal('Error', _esc(e.message), 'error'); }
    }
    function announcementsBoard() {
      const c = config; if (currentRole === 'admin') return '';
      return '<div data-key="ann-board" class="p-6 rounded-xl mt-6" style="background:' + c.surface_color + '"><div class="flex items-center gap-2 mb-3"><i data-lucide="megaphone" style="width:18px;height:18px;color:' + c.text_color + '"></i><h3 class="font-bold" style="color:' + c.text_color + '">' + tr('announcements') + '</h3></div>' +
        (announcements.length ? '<div class="space-y-2">' + announcements.slice(0, 10).map(a => '<div class="p-3 rounded-lg" style="background:' + c.text_color + '08"><div class="flex items-start justify-between gap-3"><div style="min-width:0"><div class="font-semibold" style="color:' + c.text_color + ';overflow-wrap:anywhere">' + _esc(a.title) + '</div><div class="text-sm mt-1" style="color:' + c.text_color + 'cc;white-space:pre-wrap;overflow-wrap:anywhere">' + _esc(a.message) + '</div><div class="text-xs mt-2" style="color:' + c.text_color + '88">' + (a.timestamp ? new Date(a.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '') + '</div></div>' + (currentRole === 'guidance' ? '<button class="btn-danger-ghost" onclick="deleteAnnouncement(\'' + _esc(a.id) + '\')">' + tr('delete') + '</button>' : '') + '</div></div>').join('') + '</div>' : '<p class="text-sm" style="color:' + c.text_color + '88">' + tr('noAnnouncements') + '</p>') + '</div>';
    }

    // extra live data for the features above
    function loadExtras() {
      const onErr = (n) => (e) => console.warn('[QHsafety] listener ' + n + ':', e && e.code);
      firestoreUnsubscribes.push(
        db.collection('slots').where('start', '>=', Date.now() - 3600000).orderBy('start').limit(120).onSnapshot(s => { const out = []; s.forEach(d => { const x = d.data(); if (x && /^\d{1,20}$/.test(String(x.id)) && Number(x.start) > 0) out.push({ id: String(x.id), start: Number(x.start), date: String(x.date || ''), time: String(x.time || ''), counselor: String(x.counselor || ''), takenBy: String(x.takenBy || '') }); }); slots = out; scheduleRender(); }, onErr('slots')),
        db.collection('announcements').orderBy('timestamp', 'desc').limit(20).onSnapshot(s => { const out = []; s.forEach(d => { const x = d.data(); if (x && /^\d{1,20}$/.test(String(x.id))) out.push({ id: String(x.id), title: String(x.title || ''), message: String(x.message || ''), timestamp: Number(x.timestamp) || 0 }); }); announcements = out; scheduleRender(); }, onErr('announcements'))
      );
      if (currentRole === 'guidance') firestoreUnsubscribes.push(
        db.collection('counselors').onSnapshot(s => { s.forEach(d => { if (d.id === '_templates') { const it = (d.data() || {}).items; replyTemplates = Array.isArray(it) ? it.filter(t => t && t.title && t.text).map(t => ({ title: String(t.title), text: String(t.text) })) : null; } }); scheduleRender(); }, onErr('templates')));
    }

    // ── FILIPINO FOR THE STAFF SCREENS ── exact-phrase dictionary applied to the page before it is shown
    const TL_UI = {
      'Assign to me':'I-assign sa akin','Assigned to you · release':'Naka-assign sa iyo · bitawan','All':'Lahat','High risk':'Mataas na panganib','High + Medium':'Mataas + Katamtaman','Needs reply':'Kailangan ng sagot','Assigned to me':'Naka-assign sa akin','Follow-up due':'May follow-up','Any grade':'Kahit anong baitang',
      'Remind me to follow up':'Paalalahanan akong mag-follow up','Tomorrow':'Bukas','In 3 days':'Sa loob ng 3 araw','In a week':'Sa isang linggo','In 2 weeks':'Sa 2 linggo','Clear reminder':'Alisin ang paalala','Follow up today':'Mag-follow up ngayon','Follow up tomorrow':'Mag-follow up bukas','Follow-up overdue':'Lampas na ang follow-up',
      'Saved replies…':'Mga naka-save na sagot…','Saved replies':'Mga naka-save na sagot','Edit saved replies':'I-edit ang mga sagot','Add a reply':'Magdagdag ng sagot','Save':'I-save','Cancel':'Kanselahin','Remove':'Alisin','Open':'Buksan','Done':'Tapos','Review':'Suriin',
      'Private Guidance Note':'Pribadong tala ng Guidance','Save note':'I-save ang tala','Refer Student':'I-refer ang estudyante','Session History':'Kasaysayan ng session','Send reminder':'Magpadala ng paalala','Confirm and notify student':'Kumpirmahin at abisuhan ang estudyante',
      'Schedule Google Meet':'Mag-iskedyul ng Google Meet','Schedule Phone Call':'Mag-iskedyul ng tawag','Reschedule Meeting':'Baguhin ang iskedyul','Reschedule Call':'Baguhin ang iskedyul ng tawag','Scheduled meeting':'Nakaiskedyul na pagkikita','Scheduled phone call':'Nakaiskedyul na tawag',
      '🚨 Mark Urgent':'🚨 Markahang apurahan','🔕 Unmark Urgent':'🔕 Alisin ang apurahan','URGENT':'APURAHAN','Pending':'Nakabinbin','Confirmed':'Kumpirmado','⏳ Pending':'⏳ Nakabinbin','✅ Confirmed':'✅ Kumpirmado','🎉 Done':'🎉 Tapos',
      'By grade level':'Ayon sa baitang','By strand':'Ayon sa strand','By age':'Ayon sa edad','Any strand':'Kahit anong strand',
      'Monthly report':'Buwanang ulat','Submissions':'Mga isinumite','Flagged Medium or High':'Na-flag na Katamtaman o Mataas','Typical first reply':'Karaniwang unang sagot','Still unanswered':'Wala pang sagot','By risk level':'Ayon sa antas ng panganib','By grade (consultations)':'Ayon sa baitang (konsultasyon)','Most common concerns':'Pinakakaraniwang alalahanin','Print':'I-print',
      'Send announcement to students':'Magpadala ng anunsyo sa mga estudyante','Push notification delivered to all subscribed students':'Push notification para sa lahat ng naka-subscribe na estudyante','Send to all students':'Ipadala sa lahat ng estudyante',
      'Follow-ups due':'Mga follow-up ngayon','My open times':'Mga bakante kong oras','Add time':'Idagdag','No open times yet.':'Wala pang bakanteng oras.','Case history':'Kasaysayan ng kaso','Close':'Isara',
      'User Management':'Pamamahala ng user','System Logs':'Mga log ng system','Push Notifications':'Mga push notification','Enable Push Notifications':'I-on ang push notification','Storage':'Storage','Scan now':'I-scan ngayon','Scan again':'I-scan muli',
      'Nothing matches these filters.':'Walang tumutugma sa mga filter na ito.','Reply to student...':'Sumagot sa estudyante...','Type a message for the student...':'Mag-type ng mensahe para sa estudyante...','Search consultations…':'Maghanap ng konsultasyon…',
      'Internal notes — not visible to student...':'Panloob na tala — hindi nakikita ng estudyante...','Create New Admin':'Gumawa ng bagong Admin','Create New Guidance Counselor':'Gumawa ng bagong Guidance Counselor','Create Admin Account':'Gumawa ng Admin account','Create Guidance Account':'Gumawa ng Guidance account',
      'Guidance Office':'Guidance Office','Student Portal':'Portal ng Estudyante','Admin Panel':'Panel ng Admin','Counselor':'Counselor','Student':'Estudyante','Administrator':'Administrator',
    };
    function translateTree(root) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) { const raw = n.nodeValue, key = raw.trim(); if (key && TL_UI[key]) n.nodeValue = raw.replace(key, TL_UI[key]); }
      root.querySelectorAll('[placeholder],[aria-label]').forEach(el => { ['placeholder', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v && TL_UI[v]) el.setAttribute(a, TL_UI[v]); }); });
    }

    // ── SERIOUS CASES SUMMARY (counselor dashboard) ── who needs attention today / this week / this month
    let severeRange = 'day';
    function severeSummary() {
      if (currentRole !== 'guidance') return '';
      const c = config, now = Date.now();
      const since = severeRange === 'day' ? dayStart(now) : severeRange === 'week' ? dayStart(now - 6 * 86400000) : dayStart(now - 29 * 86400000);
      const rows = [];
      postings.forEach(p => { if (p.timestamp >= since && (p.riskLevel === 'High' || p.riskLevel === 'Medium')) rows.push({ i: p, kind: 'p', title: p.title }); });
      consultationPostings.forEach(x => { if (x.timestamp >= since && (x.riskLevel === 'High' || x.riskLevel === 'Medium')) rows.push({ i: x, kind: 'c', title: x.reason }); });
      const byStudent = new Map();
      rows.forEach(r => { const k = r.i.authorId || r.i.author || '?'; if (!byStudent.has(k)) byStudent.set(k, []); byStudent.get(k).push(r); });
      const students = Array.from(byStudent.entries()).map(([who, list]) => {
        list.sort((x, y) => y.i.timestamp - x.i.timestamp);
        const high = list.filter(r => r.i.riskLevel === 'High').length;
        const waiting = list.filter(r => needsReply(r.i, r.kind)).length;
        const reasons = []; list.forEach(r => (r.i.reasons || []).forEach(x => { const t = x.replace(/\s*\(A4\)/, ''); if (reasons.indexOf(t) < 0) reasons.push(t); }));
        return { who, list, high, waiting, reasons, latest: list[0].i.timestamp, grade: (list.find(r => r.i.gradeLevel) || { i: {} }).i.gradeLevel || '' };
      }).sort((x, y) => (y.high > 0) - (x.high > 0) || y.waiting - x.waiting || y.latest - x.latest);
      const highItems = rows.filter(r => r.i.riskLevel === 'High').length, waitingAll = rows.filter(r => needsReply(r.i, r.kind)).length;
      const label = { day: 'Today', week: 'Last 7 days', month: 'Last 30 days' };
      const tile = (n, text, col) => '<div class="sev-tile" style="background:' + c.text_color + '08"><div class="sev-num" style="color:' + (n ? col : c.text_color + '88') + '">' + n + '</div><div class="sev-lab" style="color:' + c.text_color + 'aa">' + text + '</div></div>';
      const name = (w) => String(w).startsWith('anon_') ? 'Anonymous student' : _esc(w);
      const when = (t) => new Date(t).toLocaleString('en-US', severeRange === 'day' ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return '<div data-key="severe" class="p-6 rounded-xl mb-6" style="background:' + c.surface_color + ';border:1px solid ' + c.text_color + '11">' +
        '<div class="flex items-center justify-between gap-3 flex-wrap mb-4"><div class="flex items-center gap-2"><i data-lucide="alert-triangle" style="width:18px;height:18px;color:#d32f2f"></i><h3 class="font-bold" style="color:' + c.text_color + '">Students with serious concerns</h3></div>' +
        '<div class="filter-chips" role="group" aria-label="Period">' + ['day', 'week', 'month'].map(k => '<button aria-pressed="' + (severeRange === k) + '" class="filter-chip' + (severeRange === k ? ' on' : '') + '" onclick="severeRange=\'' + k + '\';render()">' + label[k] + '</button>').join('') + '</div></div>' +
        '<div class="sev-tiles">' + tile(students.length, students.length === 1 ? 'student' : 'students', c.text_color) + tile(highItems, 'high-risk ' + (highItems === 1 ? 'item' : 'items'), '#d32f2f') + tile(rows.length - highItems, 'medium-risk ' + (rows.length - highItems === 1 ? 'item' : 'items'), '#e65100') + tile(waitingAll, 'still waiting for a reply', '#d32f2f') + '</div>' +
        (students.length ? '<div class="sev-list">' + students.slice(0, 12).map(st => { const first = st.list[0];
          return '<div class="sev-row" style="border-color:' + c.text_color + '14"><div style="min-width:0;flex:1 1 220px"><div class="flex items-center gap-2 flex-wrap"><span class="sev-level" style="background:' + (st.high ? '#d32f2f' : '#e65100') + '">' + (st.high ? 'High' : 'Medium') + '</span><span class="font-semibold text-sm" style="color:' + c.text_color + ';overflow-wrap:anywhere">' + name(st.who) + '</span>' + (st.grade ? '<span class="text-xs" style="color:' + c.text_color + '88">' + _esc(st.grade) + '</span>' : '') + '</div>' +
            '<div class="text-xs mt-1" style="color:' + c.text_color + 'aa;overflow-wrap:anywhere">' + st.list.length + (st.list.length === 1 ? ' item' : ' items') + ' · latest ' + when(st.latest) + ' · “' + _esc(String(first.title).slice(0, 60)) + '”</div>' +
            (st.reasons.length ? '<div class="text-xs mt-1" style="color:' + (darkMode ? '#ef9a9a' : '#b71c1c') + ';overflow-wrap:anywhere">' + _esc(st.reasons.slice(0, 3).join(' · ')) + '</div>' : '') + '</div>' +
            '<div class="flex gap-2 items-center flex-wrap">' + (st.waiting ? '<span class="status-chip" style="color:#b71c1c;border-color:#ef9a9a">Needs reply</span>' : '<span class="status-chip" style="color:' + (darkMode ? '#a5d6a7' : '#2e7d32') + ';border-color:#a5d6a7">Replied</span>') +
            '<button class="text-xs px-3 py-1.5 rounded-lg font-semibold" style="background:' + c.text_color + '14;color:' + c.text_color + '" onclick="openHistory(\'' + first.kind + '\',\'' + first.i.id + '\')">History</button>' +
            '<button class="text-xs px-3 py-1.5 rounded-lg font-semibold" style="background:' + c.primary_action_color + ';color:#2c3e50" onclick="staffFilter={risk:\'attention\',needsReply:false,mine:false,grade:\'\',q:\'\'};goTo(\'' + (first.kind === 'c' ? 'Consultations' : 'Postings') + '\')">Open</button></div></div>'; }).join('') +
          (students.length > 12 ? '<div class="text-xs mt-2" style="color:' + c.text_color + '88">and ' + (students.length - 12) + ' more — see the Problems page.</div>' : '') + '</div>'
          : '<p class="text-sm" style="color:' + c.text_color + '99">No Medium or High risk submissions ' + (severeRange === 'day' ? 'today' : 'in the ' + label[severeRange].toLowerCase()) + '.</p>') +
        '<p class="text-xs mt-3" style="color:' + c.text_color + '77">Based on the 150 most recent postings and consultations. Risk levels come from the automatic check — read the message before acting on a label.</p></div>';
    }

    function renderDashboard() {
      const fs=config.font_size||16;
      let items,icons,itemKeys;
      if(currentRole==='admin'){items=['Dashboard','Users','Reports','Feedback','Logs','Storage','Settings'];icons=['layout-dashboard','users','bar-chart-3','message-circle','file-text','hard-drive','settings'];itemKeys=['dashboard','users','reports','feedback','logs','storagePage','settings'];}
      else if(currentRole==='student'){items=['Dashboard','Postings','Consultations','Library','Feedback','Settings'];icons=['layout-dashboard','megaphone','users','book-open','message-circle','settings'];itemKeys=['dashboard','postings','consultations','library','feedback','settings'];}
      else{items=['Dashboard','Postings','Consultations','Problems','Reports','Feedback','Settings'];icons=['layout-dashboard','megaphone','users','alert-triangle','bar-chart-3','message-circle','settings'];itemKeys=['dashboard','postings','consultations','problems','reports','feedback','settings'];}
      if(!items.includes(activeSidebarItem)) activeSidebarItem='Dashboard';
      let bottomIdx = items.map((_, i) => i), bottomMore = false;
      if (items.length > 5) {
        bottomMore = true; bottomIdx = [0, 1, 2, 3];
        const cur = items.indexOf(activeSidebarItem);
        if (cur > 3) bottomIdx[3] = cur;
      }
      const bottomItems = bottomIdx.map(i => items[i]), bottomIcons = bottomIdx.map(i => icons[i]), bottomKeys = bottomIdx.map(i => itemKeys[i]);
      const moreBadge = bottomMore && items.some((it, i) => bottomIdx.indexOf(i) < 0 && unreadCount(it)) ? '<span class="nav-badge" style="min-width:8px;width:8px;height:8px;top:-2px;right:-4px"></span>' : '';
      return `
<div data-key="dash" class="screen" style="position:relative;width:100%;overflow:hidden;display:flex;flex-direction:column">
  <div class="drawer-overlay ${mobileDrawerOpen?'open':''}" onclick="mobileDrawerOpen=false;render()"></div>
  <div class="drawer-panel ${mobileDrawerOpen?'open':''}">
    <div class="p-5 pb-2 flex items-center justify-between" style="border-bottom:1px solid #ffffff11">
      <div>${logoLockup(28,true)}<div class="mt-1 text-xs" style="color:#ffffff99">${currentRole==='admin'?'Admin Panel':currentRole==='student'?'Student Portal':'Guidance Office'}</div></div>
      <button onclick="mobileDrawerOpen=false;render()" aria-label="Close menu" style="background:none;border:none;color:#ffffffaa;cursor:pointer;padding:8px"><i data-lucide="x" style="width:20px;height:20px"></i></button>
    </div>
    <div class="p-3 mx-3 mt-4 rounded-xl flex items-center gap-3" style="background:#ffffff11">
      <div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm" style="background:${isAnonymous?'#90a4ae':'#ffee58'};color:#2c3e50">${isAnonymous?'?':_esc((currentUserEmail||'?')[0].toUpperCase())}</div>
      <div><div class="text-xs font-semibold" style="color:#fff;overflow-wrap:anywhere">${isAnonymous?'Anonymous User':_esc(currentUserEmail)}</div><div class="text-xs" style="color:#ffffff66">${currentRole==='admin'?'Administrator':currentRole==='student'?'Student':'Counselor'}${isAnonymous?' · Anonymous':''}</div></div>
    </div>
    <nav class="mt-4 flex-1 overflow-auto">${items.map((item,i)=>`<button onclick="goTo('${item}')" ${activeSidebarItem===item?'aria-current="page"':''} class="sidebar-item w-full text-left flex items-center gap-3 px-5 py-3 text-sm" style="color:${activeSidebarItem===item?'#ffee58':'#ffffffaa'};border-left:3px solid ${activeSidebarItem===item?'#ffee58':'transparent'};background:${activeSidebarItem===item?'rgba(255,238,88,0.1)':'none'}"><i data-lucide="${icons[i]}" style="width:18px;height:18px"></i><span style="flex:1">${tr(itemKeys[i])}</span>${navBadge(item)}</button>`).join('')}</nav>
    <button onclick="mobileDrawerOpen=false;render();showHelp()" class="help-btn" style="margin:0 16px 12px"><i data-lucide="life-buoy" style="width:16px;height:16px"></i>${tr('getHelp')}</button>
    <button onclick="logout()" class="flex items-center gap-2 px-5 py-4 text-sm w-full" style="background:none;border:none;cursor:pointer;color:#ffffff66;border-top:1px solid #ffffff11"><i data-lucide="log-out" style="width:16px;height:16px"></i>${tr('logout')}</button>
  </div>
  <div class="flex" style="flex:1;overflow:hidden;background-color:${config.background_color}">
    <aside class="desktop-sidebar">
      <div class="desktop-sidebar-logo">
        <div style="display:flex;align-items:center;justify-content:space-between">
          ${logoLockup(30,true)}
          ${currentRole==='guidance'?`<button onclick="enablePushNotifications()" title="Enable push notifications" style="background:none;border:none;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center;position:relative;opacity:0.7;transition:opacity 0.2s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'"><i data-lucide="bell" style="width:18px;height:18px;color:#fff"></i><span id="desk-notif-dot" data-live style="display:none;position:absolute;top:2px;right:2px;width:7px;height:7px;border-radius:50%;background:#66bb6a;border:1.5px solid #2c3e50"></span></button>`:''}
        </div>
        <div class="mt-1 text-xs font-medium" style="color:#ffffff55">${currentRole==='admin'?'Admin Panel':currentRole==='student'?'Student Portal':'Guidance Office'}</div>
      </div>
      <div class="desktop-sidebar-user">
        <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;background:${isAnonymous?'#90a4ae':config.primary_action_color};color:#2c3e50">${isAnonymous?'?':_esc((currentUserEmail||'?')[0].toUpperCase())}</div>
        <div style="overflow:hidden;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_esc(currentUserEmail)}">${isAnonymous?'Anonymous User':_esc(currentUserEmail)}</div>
          <div style="font-size:11px;color:#ffffff55">${currentRole==='admin'?'Administrator':currentRole==='student'?'Student':'Counselor'}${isAnonymous?' · Anonymous':''}</div>
        </div>
      </div>
      <nav class="desktop-sidebar-nav">${items.map((item,i)=>`<button onclick="goTo('${item}')" ${activeSidebarItem===item?'aria-current="page"':''} class="sidebar-item w-full text-left flex items-center gap-3 px-5 py-3 text-sm ${activeSidebarItem===item?'active':''}" style="background:none;border:none;cursor:pointer;color:${activeSidebarItem===item?'#ffee58':'#ffffffaa'}"><i data-lucide="${icons[i]}" style="width:18px;height:18px;flex-shrink:0"></i><span style="flex:1">${tr(itemKeys[i])}</span>${navBadge(item)}</button>`).join('')}</nav>
      <button onclick="showHelp()" class="help-btn" style="margin:0 12px 12px"><i data-lucide="life-buoy" style="width:16px;height:16px"></i>${tr('getHelp')}</button>
      <div class="desktop-sidebar-footer">
        <button onclick="logout()" class="sidebar-item w-full flex items-center gap-3 px-5 py-3 text-sm" style="background:none;border:none;cursor:pointer;color:#ffffff55"><i data-lucide="log-out" style="width:16px;height:16px;flex-shrink:0"></i><span>${tr('logout')}</span></button>
      </div>
    </aside>
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0">
      <div class="mobile-topbar">
        <button onclick="mobileDrawerOpen=true;render()" aria-label="Open menu" style="background:none;border:none;color:#fff;cursor:pointer;padding:8px;margin:-4px;display:flex;align-items:center"><i data-lucide="menu" style="width:24px;height:24px"></i></button>
        ${logoLockup(26,true)}
        <div style="display:flex;align-items:center;gap:4px">
          <button onclick="showHelp()" aria-label="${tr('getHelp')}" style="background:none;border:none;cursor:pointer;padding:8px;display:flex;color:#ffee58"><i data-lucide="life-buoy" style="width:22px;height:22px"></i></button>
          <button id="mob-notif-btn" onclick="enablePushNotifications()" title="Enable push notifications" aria-label="Notifications" style="background:none;border:none;cursor:pointer;padding:8px;display:flex;align-items:center;justify-content:center;position:relative">
            <i data-lucide="bell" style="width:22px;height:22px;color:#fff"></i>
            <span id="mob-notif-dot" data-live style="display:none;position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:#66bb6a;border:1.5px solid #2c3e50"></span>
          </button>
          <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm" style="background:${isAnonymous?'#90a4ae':'#ffee58'};color:#2c3e50">${isAnonymous?'?':_esc((currentUserEmail||'?')[0].toUpperCase())}</div>
        </div>
      </div>
      <main id="main-scroll" class="flex-1 overflow-y-auto p-4 md:p-8 mobile-main" style="background-color:${config.background_color}">
        <div class="hidden md:block mb-8">
          <h1 class="font-bold" style="font-size:${fs*1.6}px;color:${config.text_color}">${tr('welcomeBack')}, <span class="highlight-cyan">${currentRole==='admin'?tr('admin'):currentRole==='student'?tr('student'):tr('counselor')}</span></h1>
          <p class="mt-1" style="font-size:${fs*0.85}px;color:${config.text_color}88">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
        </div>
        <div class="md:hidden mb-5">
          <h2 class="font-bold" style="font-size:${fs*1.2}px;color:${config.text_color}">${tr(itemKeys[items.indexOf(activeSidebarItem)] || 'dashboard')}</h2>
          <p style="font-size:${fs*0.8}px;color:${config.text_color}66">${new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</p>
        </div>
        <div data-key="page-${activeSidebarItem}" class="fade-in">${getDashboardContent(fs)}</div>
      </main>
    </div>
  </div>
  <nav class="mobile-bottom-nav">${bottomItems.map((item,i)=>`<button class="${activeSidebarItem===item?'active':''}" ${activeSidebarItem===item?'aria-current="page"':''} onclick="goTo('${item}')"><span style="position:relative;display:flex"><i data-lucide="${bottomIcons[i]}"></i>${navBadge(item)}</span><span class="nav-label">${tr(bottomKeys[i])}</span></button>`).join('')}${bottomMore?`<button onclick="mobileDrawerOpen=true;render()" aria-label="More pages"><span style="position:relative;display:flex"><i data-lucide="more-horizontal"></i>${moreBadge}</span><span class="nav-label">${appLang==='tl'?'Iba pa':'More'}</span></button>`:''}</nav>
</div>`;
    }

    function getDashboardContent(fs) {
      const myEmail=currentUserEmail; // always use currentUserEmail (works for both auth and anon)
      const isGuidance=currentRole==='guidance';
      if(activeSidebarItem==='Reports'&&(isGuidance||currentRole==='admin')) return renderReports(fs);
      if(activeSidebarItem==='Storage'&&currentRole==='admin') return renderStorage(fs);
      if(activeSidebarItem==='Library'&&currentRole==='student') return renderLibrary(fs);

      // ── POSTINGS ──
      // ── POSTINGS ──
if(activeSidebarItem==='Postings') {
  let visiblePostings;

  if(currentRole==='guidance') {
    // Guidance sees ALL postings, sorted by urgency (AI Risk + Priority)
    visiblePostings = [...postings]
      .map(p => ({
        ...p,
        aiScore: Number(p.aiScore || 0),
        priority: (p.priority || 'Medium').trim(),
        riskLevel: (p.riskLevel || 'Low').trim()
      }))
      .sort((a, b) => getUrgencyScore(b) - getUrgencyScore(a));
  } else {
    // Students/anon: always filter by authorId (the real device ID stored at post time)
    visiblePostings = postings
      .filter(p => p.authorId === myEmail)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  // DOM filtering handles search visually - always render all posts
  const filtered = applyStaffFilter(visiblePostings, 'p');

  return `
  <div class="max-w-3xl">
  ${(currentRole === 'guidance' || currentRole === 'admin') && postings.length ? `
  <div class="mb-4 flex" style="justify-content:flex-end">
    <button onclick="deleteAllPostings()" class="btn-danger-ghost"><i data-lucide="trash-2" style="width:14px;height:14px"></i>${tr('deleteAllPostings')}</button>
  </div>` : ''}
  ${currentRole==='student' ? `
    <div class="mb-8">
      <button onclick="showPostingForm=!showPostingForm;render()" 
              class="px-6 py-3 rounded-lg font-semibold flex items-center gap-2" 
              style="background:${config.primary_action_color};color:#2c3e50">
        <i data-lucide="plus" style="width:20px;height:20px"></i> ${tr('newPosting')}
      </button>
    </div>` : ''}

  ${overdueBanner()}
  ${staffFilterBar('p', filtered.length, visiblePostings.length)}
  <div class="mb-6">
    <div class="flex items-center gap-2 px-4 py-3 rounded-lg" 
         style="background:${config.surface_color};border:1px solid ${config.text_color}22">
      <i data-lucide="search" style="width:18px;height:18px;color:${config.text_color}88"></i>
      <input type="text" placeholder="${tr('search')}" 
             id="postingSearchInput" aria-label="${tr('search')}" value="${_esc(postingSearchQuery)}" oninput="postingSearchQuery=this.value;filterPostsInDOM(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" autocomplete="off" 
             style="flex:1;background:transparent;border:none;outline:none;color:${config.text_color};font-size:${fs}px" />
    </div>
  </div>

  ${showPostingForm ? `
  <div data-key="post-form" class="p-6 rounded-xl mb-6 fade-in" style="background:${config.surface_color};border:1px solid ${config.text_color}11">
    ${postingError ? `<div class="p-3 rounded-lg mb-4 text-sm" role="alert" style="background:#fdecea;color:#b71c1c;border:1px solid #ef9a9a;text-align:center">${postingError}</div>` : ''}
    <div class="p-3 rounded-lg mb-4 text-sm" style="background:#e3f2fd;border-left:4px solid #1565c0;color:#1a237e">
      ${tr('postGuide')}
    </div>
    ${afterHoursNote()}
    <h3 class="font-bold mb-4" style="font-size:${fs*1.1}px;color:${config.text_color}">${tr('newPosting')}</h3>
    <div class="flex gap-2 mb-3 p-1 rounded-lg" role="group" style="background:${config.text_color}0d">
      ${[['me',tr('aboutMe')],['other',tr('aboutOther')]].map(o=>`<button aria-pressed="${postingAbout===o[0]}" onclick="postingAbout='${o[0]}';render()" class="flex-1 py-2 rounded-md font-semibold btn-row" style="font-size:13px;line-height:1.2;padding-left:6px;padding-right:6px;background:${postingAbout===o[0]?config.surface_color:'transparent'};color:${config.text_color};${postingAbout===o[0]?'box-shadow:0 1px 3px rgba(0,0,0,.12)':''}">${o[1]}</button>`).join('')}
    </div>
    ${postingAbout==='other'?`<input type="text" aria-label="${tr('aboutWho')}" placeholder="${tr('aboutWho')}" maxlength="80" value="${_esc(postingAboutWho)}" oninput="postingAboutWho=this.value" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color}" />`:''}
    <input type="text" id="postingTitleInput" placeholder="${tr('title')}" aria-label="${tr('title')}" maxlength="140" value="${_esc(postingTitle)}" 
           onkeydown="if(event.key==='Enter'){event.preventDefault();}" oninput="postingTitle=this.value;onFieldInput()" 
           style="width:100%;padding:12px;margin-bottom:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color}" />
    <div class="mb-3"><label style="display:block;font-size:13px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('priority')}</label><div class="flex gap-2">${['Low','Medium','High'].map(lv=>`<button onclick="postingPriority='${lv}';render()" aria-pressed="${postingPriority===lv}" class="px-2 py-2 rounded-lg flex-1 text-sm font-bold" style="text-align:center;white-space:nowrap;background:${postingPriority===lv?(lv==='High'?'#ef5350':lv==='Medium'?'#ff9800':'#66bb6a'):config.text_color+'18'};color:${postingPriority===lv?'#fff':config.text_color};border:2px solid ${postingPriority===lv?(lv==='High'?'#ef5350':lv==='Medium'?'#ff9800':'#66bb6a'):'transparent'}">${lv==='High'?'🔴':lv==='Medium'?'🟠':'🟢'} ${tr(lv.toLowerCase())}</button>`).join('')}</div></div>
    <textarea id="postingContentTA" placeholder="${tr('content')}" aria-label="${tr('content')}" maxlength="1800" oninput="postingContent=this.value;onFieldInput()" 
              style="width:100%;padding:12px;margin-bottom:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};min-height:100px;resize:vertical">${_esc(postingContent)}</textarea>
    ${aboutYouFields()}
    <div class="mb-4">
      <label style="display:block;font-size:13px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('pHelpHow')}</label>
      <div class="flex gap-2 flex-wrap" role="group" aria-label="${tr('pHelpHow')}">
        ${[{v:'chat',l:tr('cChat')},{v:'meet',l:tr('cMeet')},{v:'facetoface',l:tr('cFace')},{v:'phone',l:tr('cPhone')}].map(o=>`<button aria-pressed="${postingContactPref===o.v}" data-help="${o.v}" onclick="postingContactPref='${o.v}';render()" style="flex:1;min-width:80px;padding:8px 6px;border-radius:8px;font-size:12px;font-weight:600;border:2px solid ${postingContactPref===o.v?config.primary_action_color:config.text_color+'22'};background:${postingContactPref===o.v?config.primary_action_color+'22':'transparent'};color:${config.text_color};text-align:center">${o.l}</button>`).join('')}
      </div>
      ${postingContactPref!=='chat'?`<div class="mt-2 text-xs" style="color:${config.text_color}99">${tr('pMeetNote')}</div>`:''}
    </div>
    <div class="flex gap-3">
      <button onclick="addPosting()" class="px-4 py-2 rounded-lg font-semibold" 
              style="background:${config.primary_action_color};color:#2c3e50">${tr('publish')}</button>
      <button onclick="showPostingForm=false;postingTitle='';postingContent='';postingError='';render()" 
              class="px-4 py-2 rounded-lg font-semibold" 
              style="background:${config.text_color}22;color:${config.text_color}">${tr('cancel')}</button>
    </div>
  </div>` : ''}

  <div data-key="post-list" class="space-y-4">
    <div id="postings-no-match"  class="p-6 rounded-xl text-sm text-center" style="display:none;background:${config.surface_color};border:1px dashed ${config.text_color}22;color:${config.text_color}99">${tr('noMatch')}</div>
    ${filtered.length === 0
      ? `<div class="p-8 rounded-xl flex flex-col items-center" style="background:${config.surface_color};border:1px dashed ${config.text_color}33">
           <i data-lucide="megaphone" style="width:32px;height:32px;color:${config.text_color}55"></i>
           <p class="mt-3 text-sm" style="color:${config.text_color}99">${!dataLoaded.postings ? tr('loading') : visiblePostings.length ? 'Nothing matches these filters.' : tr('noPostings')}</p>
         </div>`
      : filtered.slice(0, postLimit).map(p => {
          const isPending = true; // Postings are always "active"
          const gc = getGlowClass(p, isPending);

          return keep('p'+p.id, `
      <div data-key="p${p.id}" ${isGuidance&&!p.seenAt?`data-unseen="postings:${p.id}"`:''} data-post-id="${_esc(p.id)}" data-search-text="${_esc(((p.title||'')+' '+(p.content||'')+' '+(p.author||'')).toLowerCase())}" class="p-6 rounded-xl ${gc}"
           style="background:${config.surface_color};border:1px solid ${config.text_color}11">
        <div class="flex items-start justify-between mb-3">
          <div class="flex-1">
            <h3 class="font-bold" style="font-size:${fs*1.1}px;color:${config.text_color}">${_esc(p.title)} ${newChip(p,'p')}</h3>
            ${p.aboutOther?`<div class="mt-2"><span class="text-xs px-2 py-1 rounded-md font-semibold" style="background:#e3f2fd;color:#0d47a1">${tr('aboutOther')}${p.aboutWho?': '+_esc(p.aboutWho):''}</span></div>`:''}
            ${demoLabel(p)&&currentRole!=='student'?`<div class="mt-2"><span class="text-xs px-2 py-1 rounded-md font-semibold" style="background:${config.text_color}11;color:${config.text_color}aa">${_esc(demoLabel(p))}</span></div>`:''}
            
            ${currentRole==='guidance' ? `
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              ${p.riskLevel ? `<span class="text-xs px-3 py-1 rounded-full font-bold" 
                style="background:${p.riskLevel==='High'?'#d32f2f':p.riskLevel==='Medium'?'#e65100':p.riskLevel==='Low-Medium'?'#8d6e00':'#2e7d32'};color:#fff">
                ${riskLabel(p.riskLevel)} · AI ${_esc(String(p.aiScore||0))}
              </span>` : ''}
              
              ${p.priority ? `<span class="text-xs px-3 py-1 rounded-full font-bold" 
                style="background:${p.priority==='High'?'#ef535022':p.priority==='Medium'?'#ff980022':'#66bb6a22'};color:${getPriorityColor(p.priority)};border:1.5px solid ${getPriorityColor(p.priority)}">
                ${p.priority==='High'?'⚡':p.priority==='Medium'?'▲':'▽'} ${tr(p.priority.toLowerCase())} ${appLang==='tl'?'Prioridad':'Priority'}
              </span>` : ''}
              
              ${p.reasons && p.reasons.length ? `<span class="text-xs" style="color:${darkMode?'#ef9a9a':'#b71c1c'};flex-basis:100%">${_esc(p.reasons.join(' · '))}</span>` : ''}
            </div>` : ''}

            <div class="text-xs mt-2" style="color:${config.text_color}66">
              ${p.author ? `${tr('by')}: ${historyLink('p', p)}` : ''} • ${new Date(p.timestamp || Date.now()).toLocaleDateString()}
            </div>
            <div class="flex gap-2 flex-wrap mt-2">${statusChip(p)}${assignControl('postings', p)}${followControl('postings', p)}</div>
          </div>
          
          ${canDelete(p, 'posting') ? `
  <button onclick="deletePosting(${p.id})" 
          class="text-xs px-4 py-1.5 rounded-lg font-medium shrink-0" 
          style="background:#ef5350;color:#fff">
    ${tr('delete')}
  </button>` : ''}
                  </div>
        <p style="color:${config.text_color}cc; line-height:1.55;max-height:160px;overflow-y:auto;padding-right:4px;white-space:pre-wrap;overflow-wrap:anywhere">${_esc(p.content)}</p>

        ${p.guidanceMessage ? `
        <div class="mt-3 p-3 rounded-lg" style="background:#e3f2fd;border-left:4px solid #1565c0">
          <div class="text-xs font-bold mb-1" style="color:#1565c0">${tr('msgFromGuidance')}${p.guidanceMessageAt ? ' · ' + _esc(p.guidanceMessageAt) : ''}</div>
          <p class="text-sm" style="color:#1a237e;white-space:pre-wrap;overflow-wrap:anywhere">${_esc(p.guidanceMessage)}</p>
        </div>` : ''}

        ${currentRole === 'guidance' ? `
        <div class="mt-3 pt-3" style="border-top:1px solid ${config.text_color}11">
          <div class="flex items-center justify-between gap-2 flex-wrap mb-2"><div class="text-xs font-bold" style="color:${config.text_color}99">${tr('guidanceReply')}</div>${templatePicker('p', p.id)}</div>
          <div class="flex gap-2">
            <textarea id="gmsg_${p.id}" rows="2" placeholder="Type a message for the student..." aria-label="Message for the student" 
              oninput="guidanceMessageDraft['${p.id}']=this.value;onFieldInput()"
              style="flex:1;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px;resize:none">${_esc(guidanceMessageDraft[p.id]||'')}</textarea>
            <button onclick="sendGuidanceMessage(${p.id})" 
              style="padding:8px 14px;background:#1565c0;color:#fff;border-radius:8px;font-weight:700;font-size:13px;white-space:nowrap;align-self:flex-end">
              ${tr('send')}
            </button>
          </div>
        </div>` : ''}

        <!-- Student/anyone chat thread on postings -->
        <div class="mt-3 pt-3" style="border-top:1px solid ${config.text_color}11">
          <div class="text-xs font-bold mb-2" style="color:${config.text_color}99">${tr('comments')}</div>
          ${(p.chatMessages && p.chatMessages.length) ? `
          <div id="postChatBox_${p.id}" class="chat-scroll" style="max-height:180px;margin-bottom:10px;padding-right:4px"><div class="chat-list">
            ${p.chatMessages.map(m=>`
            <div style="display:flex;flex-direction:${(m.sender===currentUserEmail||m.sender==='Anonymous'&&isAnonymous)?'row-reverse':'row'};gap:8px;align-items:flex-end">
              <div style="max-width:75%;padding:8px 12px;border-radius:14px;font-size:13px;background:${(m.sender===currentUserEmail||m.sender==='Anonymous'&&isAnonymous)?config.primary_action_color:config.text_color+'18'};color:${(m.sender===currentUserEmail||m.sender==='Anonymous'&&isAnonymous)?'#2c3e50':config.text_color}">
                <div style="font-size:10px;font-weight:700;margin-bottom:2px;opacity:0.75">${m.role==='guidance'?'Guidance':m.sender==='Anonymous'?'Anonymous':_esc(String(m.sender||'').split('@')[0])}</div>
                <span style="white-space:pre-wrap;overflow-wrap:anywhere">${_esc(m.text)}</span>
                <div style="font-size:10px;margin-top:2px;opacity:0.5;text-align:right">${_esc(m.time||'')}</div>
              </div>
            </div>`).join('')}
          </div></div>` : `<p style="font-size:12px;color:${config.text_color}88;margin-bottom:8px">${tr('noComments')}</p>`}
          <div style="display:flex;gap:8px">
            <input id="postChat_${p.id}" type="text" placeholder="${tr('addComment')}" aria-label="${tr('addComment')}" maxlength="1000" value="${_esc(postingChatDraft[p.id]||'')}" 
              oninput="postingChatDraft['${p.id}']=this.value"
              onkeydown="if(event.key==='Enter'){event.preventDefault();sendPostingChat(${p.id})}"
              style="flex:1;padding:8px 12px;border:1px solid ${config.text_color}22;border-radius:20px;background:${config.background_color};color:${config.text_color};font-size:13px;outline:none" />
            <button onclick="sendPostingChat(${p.id})" 
              style="padding:8px 14px;background:${config.primary_action_color};color:#2c3e50;border-radius:20px;font-weight:700;font-size:13px;white-space:nowrap;flex-shrink:0">${tr('send')}</button>
          </div>
        </div>
      </div>`);
        }).join('')}
    ${filtered.length > postLimit ? `<button onclick="postLimit+=25;render()" class="w-full py-3 rounded-lg text-sm font-semibold" style="background:${config.text_color}11;color:${config.text_color}">Show more (${filtered.length - postLimit} remaining)</button>` : ''}
  </div>
</div>`;
}

      // ── CONSULTATIONS ──
      if(activeSidebarItem==='Consultations') {
        let visibleConsultations=isGuidance
          ?[...consultationPostings].map(c=>({...c,aiScore:Number(c.aiScore||0),priority:(c.priority||'Medium').trim(),riskLevel:(c.riskLevel||'Low').trim(),status:(c.status||'Pending').trim()}))
            .sort((a,b)=>{
              // Pending before Done
              if(a.status==='Pending'&&b.status!=='Pending')return -1;
              if(a.status!=='Pending'&&b.status==='Pending')return 1;
              // Among pending: highest urgency first
              if(a.status==='Pending')return getUrgencyScore(b)-getUrgencyScore(a);
              // Among done: newest first
              return(b.timestamp||0)-(a.timestamp||0);
            })
          :consultationPostings.filter(c=>c.authorId===myEmail||c.author===myEmail||c.studentEmail===myEmail);
        const allConsultations=visibleConsultations;
        visibleConsultations=applyStaffFilter(visibleConsultations,'c');

        return `
        <div class="max-w-3xl">
  <div class="flex justify-between items-center mb-6 flex-wrap gap-3">
    <h2 class="font-bold text-2xl hidden md:block" style="color:${config.text_color}">${tr('consultations')}</h2>
    ${(currentRole === 'guidance' || currentRole === 'admin') && consultationPostings.length ? `<button onclick="deleteAllConsultations()" class="btn-danger-ghost" style="margin-left:auto"><i data-lucide="trash-2" style="width:14px;height:14px"></i>${tr('deleteAllConsult')}</button>` : ''}
    ${currentRole==='student'?`<button onclick="showConsultationForm=true;render()" class="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold" style="background:${config.primary_action_color};color:#2c3e50"><i data-lucide="plus" style="width:18px;height:18px"></i> ${tr('newConsultation')}</button>`:''}
  </div>
  ${showConsultationForm?`
  <div data-key="consult-form" class="p-6 rounded-xl mb-8 fade-in" style="background:${config.surface_color};border:1px solid ${config.text_color}11;box-shadow:0 4px 24px rgba(0,0,0,0.07)">
    ${consultationError?`<div class="p-3 rounded-lg mb-4 text-sm" role="alert" style="background:#fdecea;color:#b71c1c;border:1px solid #ef9a9a;text-align:center">${consultationError}</div>`:''}
    <div class="p-3 rounded-lg mb-5 text-sm" style="background:#e8f5e9;border-left:4px solid #2e7d32;color:#1b5e20">
      ${tr('cGuide')}
    </div>
    ${afterHoursNote()}
    <h3 class="font-bold mb-5" style="font-size:${fs*1.1}px;color:${config.text_color}">${tr('cNew')}</h3>

    <!-- Grade, strand, age -->
    ${aboutYouFields()}

    <!-- Reason + Priority -->
    <div class="mb-4">
      <label style="display:block;font-size:14px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('cReason')}</label>
      <input type="text" id="consultReasonInput" placeholder="${tr('cReasonPh')}" aria-label="Reason or topic" maxlength="140" value="${_esc(consultationReason||'')}" onkeydown="if(event.key==='Enter'){event.preventDefault();}" oninput="consultationReason=this.value;onFieldInput()" style="width:100%;padding:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:14px" />
    </div>
    <div class="mb-4">
      <label style="display:block;font-size:14px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('cPriority')}</label>
      <div class="flex gap-2">${['Low','Medium','High'].map(p=>`<button onclick="consultationPriority='${p}';render()" aria-pressed="${consultationPriority===p}" class="px-2 py-2 rounded-lg flex-1 text-sm font-semibold" style="text-align:center;white-space:nowrap;background:${consultationPriority===p?(p==='High'?'#ef5350':p==='Medium'?'#ff9800':'#66bb6a'):config.text_color+'18'};color:${consultationPriority===p?'#fff':config.text_color}">${p==='High'?'🔴':p==='Medium'?'🟠':'🟢'} ${tr(p.toLowerCase())}</button>`).join('')}</div>
    </div>

    <!-- How are you feeling (mood slider) -->
    <div class="mb-4 p-4 rounded-xl" style="background:${config.text_color}07;border:1px solid ${config.text_color}11">
      <label style="display:block;font-size:14px;font-weight:600;color:${config.text_color};margin-bottom:10px">${tr('cFeel')}</label>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        ${['😞','😕','😐','🙂','😊'].map((e,i)=>`<button onclick="consultationMoodLevel=${i+1};render()" aria-label="${['Very sad','Sad','Neutral','Good','Great'][i]}" aria-pressed="${consultationMoodLevel===i+1}" style="flex:1 1 0;min-width:0;font-size:24px;line-height:1;padding:6px 2px;transform:scale(${consultationMoodLevel===i+1?'1.2':'1'});opacity:${consultationMoodLevel===i+1?'1':'0.45'};background:none;border:none;cursor:pointer">${e}</button>`).join('')}
      </div>
      <div style="text-align:center;font-size:12px;font-weight:600;color:${config.text_color}88">${trList('moods')[consultationMoodLevel-1]}</div>
    </div>

    <!-- Contact Preference -->
    <div class="mb-4">
      <label style="display:block;font-size:14px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('cContact')}</label>
      <div class="flex gap-2 flex-wrap">
        ${[{v:'chat',l:tr('cChat')},{v:'meet',l:tr('cMeet')},{v:'facetoface',l:tr('cFace')},{v:'phone',l:tr('cPhone')}].map(o=>`<button onclick="consultationContactPref='${o.v}';render()" style="flex:1;min-width:80px;padding:8px 6px;border-radius:8px;font-size:12px;font-weight:600;border:2px solid ${consultationContactPref===o.v?config.primary_action_color:config.text_color+'22'};background:${consultationContactPref===o.v?config.primary_action_color+'22':'transparent'};color:${config.text_color};text-align:center">${o.l}</button>`).join('')}
      </div>
    </div>

    <!-- Details textarea -->
    <div class="mb-5">
      <label style="display:block;font-size:14px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('cDescribe')}</label>
      <textarea id="consultDescTA" aria-label="Describe your concern" maxlength="1800" placeholder="${tr('cDescribePh')}" oninput="consultationDescription=this.value;onFieldInput()" style="width:100%;padding:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};min-height:120px;resize:vertical;font-size:14px">${_esc(consultationDescription||'')}</textarea>
    </div>

    <div class="flex gap-3">
      <button onclick="addConsultation()" class="px-6 py-3 rounded-lg font-bold flex-1 btn-row" style="background:${config.primary_action_color};color:#2c3e50">${tr('submitRequest')}</button>
      <button onclick="showConsultationForm=false;consultationReason='';consultationDescription='';consultationPriority='Medium';consultationGradeLevel='';consultationContactPref='chat';consultationMoodLevel=3;consultationError='';render()" class="px-6 py-3 rounded-lg font-semibold" style="background:${config.text_color}22;color:${config.text_color}">${tr('cancel')}</button>
    </div>
  </div>`:''}
  ${overdueBanner()}
  ${slotPanel()}
  ${staffFilterBar('c', visibleConsultations.length, allConsultations.length)}
  <div data-key="consult-list" class="space-y-4">
    ${visibleConsultations.length===0
      ?`<div class="p-8 rounded-xl flex flex-col items-center" style="background:${config.surface_color};border:1px dashed ${config.text_color}33"><i data-lucide="calendar" style="width:32px;height:32px;color:${config.text_color}55"></i><p class="mt-3 text-sm" style="color:${config.text_color}99">${!dataLoaded.consultations ? tr('loading') : allConsultations.length ? 'Nothing matches these filters.' : tr('noConsultations')}</p></div>`
      :visibleConsultations.slice(0, consultLimit).map(c=>{
        const isPending=c.status==='Pending';
        const gc=getGlowClass(c,isPending);
        return keep('c'+c.id, `
        <div data-key="c${c.id}" ${isGuidance&&!c.seenAt?`data-unseen="consultations:${c.id}"`:''} data-consult-id="${c.id}" class="p-5 rounded-xl ${gc}" style="background:${config.surface_color};border:1px solid ${config.text_color}11">

          <!-- TOP: badges row -->
          <div class="flex flex-wrap gap-2 mb-3">
            <span class="text-xs px-2 py-1 rounded-md font-bold" style="background:${isPending?(c.priority==='High'?'#ef5350':c.priority==='Medium'?'#ff9800':'#66bb6a'):'#66bb6a'};color:#fff">
              ${isPending?(c.priority==='High'?'⚡ ':c.priority==='Medium'?'▲ ':'▽ ')+c.priority+' Priority':tr('resolved')}
            </span>
            ${c.urgent?`<span class="text-xs px-2 py-1 rounded-md font-bold" style="background:#b71c1c;color:#fff">URGENT</span>`:''}
            ${isGuidance&&c.riskLevel&&isPending?`<span class="text-xs px-2 py-1 rounded-md font-bold" style="background:${c.riskLevel==='High'?'#ef5350':c.riskLevel==='Medium'?'#ff9800':'#66bb6a'};color:#fff">${c.riskLevel==='High'?'🔴':c.riskLevel==='Medium'?'🟠':'🟢'} AI Risk: ${c.riskLevel} · ${c.aiScore}</span>`:''}
            ${demoLabel(c)?`<span class="text-xs px-2 py-1 rounded-md font-semibold" style="background:#e3f2fd;color:#1565c0">${_esc(demoLabel(c))}</span>`:''}
            ${c.aboutOther?`<span class="text-xs px-2 py-1 rounded-md font-semibold" style="background:#e3f2fd;color:#0d47a1">${tr('aboutOther')}${c.aboutWho?': '+_esc(c.aboutWho):''}</span>`:''}
            ${c.contactPref?`<span class="text-xs px-2 py-1 rounded-md font-semibold" style="background:${config.text_color}11;color:${config.text_color}88">${c.contactPref==='meet'?'📹 Google Meet':c.contactPref==='facetoface'?'🏫 Face to Face':c.contactPref==='phone'?'📱 Phone Call':'💬 Chat'}</span>`:''}
            ${c.studentMood?`<span class="text-xs px-2 py-1 rounded-md font-semibold" style="background:${config.text_color}11;color:${config.text_color}88">${['😞','😕','😐','🙂','😊'][c.studentMood-1]} ${['Very sad','Sad','Neutral','Good','Great'][c.studentMood-1]}</span>`:''}
            ${c.meetDateTime?`<span class="text-xs px-2 py-1 rounded-md font-bold" style="background:#e8f5e9;color:#2e7d32">${c.contactPref==='phone'?'Call':'Meet'}: ${new Date(c.meetDateTime).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>`:''}
            ${c.referredTo?`<span class="text-xs px-2 py-1 rounded-md font-bold" style="background:#fff3e0;color:#bf360c">Referred: ${_esc(c.referredTo)}</span>`:''}
          </div>

          <!-- Title + action buttons -->
          <div class="flex flex-col md:flex-row justify-between items-start gap-3 mb-3">
            <div class="flex-1">
              <h3 class="font-bold" style="font-size:${fs*1.05}px;color:${config.text_color}">${_esc(c.reason)} ${newChip(c,'c')}</h3>
              <div class="flex gap-2 flex-wrap mt-2">${statusChip(c)}${assignControl('consultations', c)}${followControl('consultations', c)}</div>
              ${isGuidance?`<div class="text-xs mt-2 flex gap-3 flex-wrap" style="color:${config.text_color}99">
                <span>${historyLink('c', c)}</span>
                <span><strong style="color:${isPending?'#e65100':'#2e7d32'}">${_esc(c.status||'Pending')}</strong></span>
                <span>${c.timestamp?new Date(c.timestamp).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''}</span>
              </div>`:''}
            </div>
            <div class="flex gap-2 flex-wrap shrink-0">
              ${currentRole==='student'&&c.status==='Pending'&&canDelete(c,'consultation')?`<button onclick="deleteConsultationPosting('${c.id}')" class="btn-danger-ghost">${appLang==='tl'?'Kanselahin ang kahilingan':'Cancel request'}</button>`
                :canDelete(c,'consultation')?`<button onclick="deleteConsultation('${c.id}')" class="btn-danger-ghost">${tr('delete')}</button>`:''}
              ${currentRole==='guidance'&&c.status==='Pending'?`
                <button onclick="toggleConsultUrgent('${c.id}',${!!c.urgent})" class="text-xs px-3 py-1.5 rounded-lg font-medium" style="background:${c.urgent?'#b71c1c22':'#ff980022'};color:${c.urgent?'#b71c1c':'#e65100'};border:1px solid ${c.urgent?'#b71c1c44':'#ff980044'}">${c.urgent?'🔕 Unmark Urgent':'🚨 Mark Urgent'}</button>
                <button onclick="updateConsultationStatus('${c.id}')" class="text-xs px-3 py-1.5 rounded-lg font-medium" style="background:${config.secondary_action_color};color:#2c3e50">${tr('markResolved')}</button>
              `:''}
            </div>
          </div>

          <!-- Description -->
          <div style="max-height:140px;overflow-y:auto;padding-right:4px;margin-bottom:12px">
            <p style="color:${config.text_color}cc;line-height:1.6;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere">${_esc(c.description)}</p>
          </div>

          <!-- Meet Banner (if scheduled) -->
          ${c.meetDateTime?`
          <div class="mb-3 p-3 rounded-xl" style="background:#e8f5e9;border:1px solid #66bb6a44">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div class="font-bold text-sm" style="color:#2e7d32">${c.contactPref==='phone'?'Scheduled phone call':'Scheduled meeting'}</div>
                <div class="text-xs mt-1" style="color:#2e7d32">${new Date(c.meetDateTime).toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</div>
                ${c.meetNotes?`<div class="text-xs mt-1" style="color:#2e7d32;overflow-wrap:anywhere">${_esc(c.meetNotes)}</div>`:''}
              </div>
              <div class="flex gap-2">
                ${c.meetLink&&c.contactPref==='phone'?`<a href="tel:${_esc(String(c.meetLink).replace(/[^\d+]/g,''))}" class="text-xs px-3 py-1.5 rounded-lg font-bold" style="background:#2e7d32;color:#fff;text-decoration:none">Call ${_esc(c.meetLink)}</a>`
                  :c.meetLink&&safeHttpUrl(c.meetLink)?`<a href="${_esc(safeHttpUrl(c.meetLink))}" target="_blank" rel="noopener noreferrer" class="text-xs px-3 py-1.5 rounded-lg font-bold" style="background:#2e7d32;color:#fff;text-decoration:none">Join Meet</a>`:''}
                ${currentRole==='guidance'?`<button onclick="cancelConsultMeet('${c.id}')" class="text-xs px-3 py-1.5 rounded-lg font-medium" style="background:#ef535022;color:#ef5350">Cancel</button>`:''}
              </div>
            </div>
          </div>`:''}

          <!-- GUIDANCE TOOLS (only visible to guidance) -->
          ${currentRole==='guidance'?`
          <div class="mb-3" style="border:1px solid ${config.text_color}11;border-radius:12px;overflow:hidden">

            <!-- Schedule Meet / Phone Call Accordion -->
            <button onclick="toggleMeetScheduler('${c.id}')" aria-expanded="${!!showMeetScheduler[c.id]}" class="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold" style="background:${showMeetScheduler[c.id]?'#e8f5e9':config.text_color+'08'};color:${showMeetScheduler[c.id]?'#2e7d32':config.text_color};border:none;cursor:pointer">
              <span>${c.meetDateTime?(c.contactPref==='phone'?'Reschedule Call':'Reschedule Meeting'):(c.contactPref==='phone'?'Schedule Phone Call':'Schedule Google Meet')}</span>
              <i data-lucide="${showMeetScheduler[c.id]?'chevron-up':'chevron-down'}" style="width:16px;height:16px"></i>
            </button>
            ${showMeetScheduler[c.id]?`
            <div class="p-4" style="background:${config.text_color}05;border-top:1px solid ${config.text_color}11">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:10px">
                <div>
                  <label style="display:block;font-size:11px;font-weight:700;color:${config.text_color}88;margin-bottom:4px">📅 DATE</label>
                  <input type="date" id="meet-date-${c.id}" value="${_esc(consultMeetDraft.date||'')}" oninput="consultMeetDraft.date=this.value;onFieldInput()" style="width:100%;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px" />
                </div>
                <div>
                  <label style="display:block;font-size:11px;font-weight:700;color:${config.text_color}88;margin-bottom:4px">⏰ TIME</label>
                  <input type="time" id="meet-time-${c.id}" value="${_esc(consultMeetDraft.time||'')}" oninput="consultMeetDraft.time=this.value;onFieldInput()" style="width:100%;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px" />
                </div>
              </div>
              ${c.contactPref==='phone'?`
              <div style="margin-bottom:10px">
                <label style="display:block;font-size:11px;font-weight:700;color:${config.text_color}88;margin-bottom:4px">📱 PHONE NUMBER TO CALL</label>
                <input type="tel" id="meet-link-${c.id}" value="${_esc(consultMeetDraft.link||'')}" oninput="consultMeetDraft.link=this.value;onFieldInput()" placeholder="+63 9XX XXX XXXX" style="width:100%;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px" />
                <p style="font-size:11px;color:${config.text_color}55;margin-top:4px">💡 The student will see this number and know to expect your call.</p>
              </div>`:`
              <div style="margin-bottom:10px">
                <label style="display:block;font-size:11px;font-weight:700;color:${config.text_color}88;margin-bottom:4px">🔗 GOOGLE MEET LINK (optional)</label>
                <input type="url" id="meet-link-${c.id}" value="${_esc(consultMeetDraft.link||'')}" oninput="consultMeetDraft.link=this.value;onFieldInput()" placeholder="https://meet.google.com/xxx-xxxx-xxx" style="width:100%;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px" />
                <p style="font-size:11px;color:${config.text_color}55;margin-top:4px">💡 Create a meet at <a href="https://meet.google.com" target="_blank" style="color:#1565c0">meet.google.com</a> and paste the link above.</p>
              </div>`}
              <div style="margin-bottom:12px">
                <label style="display:block;font-size:11px;font-weight:700;color:${config.text_color}88;margin-bottom:4px">📝 NOTES FOR STUDENT (optional)</label>
                <input type="text" id="meet-notes-${c.id}" value="${_esc(consultMeetDraft.notes||'')}" oninput="consultMeetDraft.notes=this.value;onFieldInput()" placeholder="e.g. Please bring your report card..." style="width:100%;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px" />
              </div>
              <button onclick="scheduleConsultMeet('${c.id}')" class="w-full py-2.5 rounded-lg font-bold text-sm btn-row" style="background:#2e7d32;color:#fff">Confirm and notify student</button>
            </div>`:''}

            <!-- Private Guidance Note -->
            <div style="border-top:1px solid ${config.text_color}11">
              <div class="px-4 py-3 flex items-center gap-2" style="background:${config.text_color}04">
                <i data-lucide="lock" style="width:13px;height:13px;color:${config.text_color}55"></i>
                <span class="text-xs font-bold" style="color:${config.text_color}66;text-transform:uppercase;letter-spacing:.05em">Private Guidance Note</span>
              </div>
              <div class="px-4 pb-3">
                <textarea data-keep id="guidance-note-${c.id}" aria-label="Private guidance note" placeholder="Internal notes — not visible to student..." style="width:100%;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px;min-height:60px;resize:vertical">${_esc(c.guidanceNote||'')}</textarea>
                <button onclick="saveGuidanceNote('${c.id}')" class="mt-2 px-4 py-1.5 rounded-lg text-xs font-bold" style="background:${config.text_color}18;color:${config.text_color}">Save note</button>
                ${c.noteUpdatedAt?`<span class="text-xs ml-2" style="color:${config.text_color}88">Last saved: ${new Date(c.noteUpdatedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>`:''}
              </div>
            </div>

            <!-- Referral -->
            <div style="border-top:1px solid ${config.text_color}11">
              <div class="px-4 py-3 flex items-center gap-2" style="background:${config.text_color}04">
                <i data-lucide="external-link" style="width:13px;height:13px;color:${config.text_color}55"></i>
                <span class="text-xs font-bold" style="color:${config.text_color}66;text-transform:uppercase;letter-spacing:.05em">Refer Student</span>
              </div>
              <div class="px-4 pb-3 flex gap-2">
                <input data-keep id="referral-${c.id}" type="text" aria-label="Refer student to" value="${_esc(c.referredTo||'')}" placeholder="e.g. School Psychologist, DSWD, Admin..." style="flex:1;padding:8px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:13px" />
                <button onclick="saveReferral('${c.id}')" class="px-3 py-1.5 rounded-lg text-xs font-bold" style="background:#90caf9;color:#1a237e;flex-shrink:0">Save</button>
              </div>
            </div>

          </div>
          `:''}

          ${slotPicker(c)}
          <!-- STUDENT: Mood Update -->
          ${currentRole==='student'&&isPending?`
          <div class="mb-3 p-3 rounded-xl flex items-center gap-3 flex-wrap" style="background:${config.text_color}07;border:1px solid ${config.text_color}11">
            <span class="text-xs font-bold" style="color:${config.text_color}aa">${tr('updateMood')}</span>
            ${['😞','😕','😐','🙂','😊'].map((e,i)=>`<button onclick="saveConsultMood('${c.id}',${i+1})" aria-label="${['Very sad','Sad','Neutral','Good','Great'][i]}" aria-pressed="${(c.studentMood||3)===i+1}" style="font-size:20px;line-height:1;padding:6px;transform:scale(${(c.studentMood||3)===i+1?'1.2':'1'});opacity:${(c.studentMood||3)===i+1?'1':'0.4'};background:none;border:none;cursor:pointer">${e}</button>`).join('')}
          </div>`:''}

          <!-- ── APPOINTMENT STATUS TRACKER ── -->
          <div class="mb-3 p-3 rounded-xl" style="background:${config.text_color}06;border:1px solid ${config.text_color}11">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:6px">
                <i data-lucide="clipboard-check" style="width:13px;height:13px;color:${config.text_color}55"></i>
                <span style="font-size:11px;font-weight:700;color:${config.text_color}66;text-transform:uppercase;letter-spacing:.05em">${tr('apptStatus')}</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${['Pending','Confirmed','Done'].map(s=>{
                  const cur = c.appointmentStatus||'Pending';
                  const colors = {Pending:'#ff9800',Confirmed:'#1565c0',Done:'#2e7d32'};
                  const icons = {Pending:'⏳',Confirmed:'✅',Done:'🎉'};
                  const isActive = cur===s;
                  const canClick = currentRole==='guidance' && cur!==s && !(cur==='Done');
                  return `<button ${canClick?`onclick="updateAppointmentStatus('${c.id}','${s}')"`:'disabled'} style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;border:2px solid ${isActive?colors[s]:config.text_color+'22'};background:${isActive?colors[s]+'22':'transparent'};color:${isActive?colors[s]:config.text_color+'44'};cursor:${canClick?'pointer':'default'}">${icons[s]} ${s}</button>`;
                }).join('')}
              </div>
            </div>
          </div>

          <!-- ── SESSION HISTORY & NOTES (collapsible) ── -->
          ${(c.chatMessages&&c.chatMessages.length>0)||(c.guidanceNote&&currentRole==='guidance')||(c.sessionRating)?`
          <details class="mb-3" style="border:1px solid ${config.text_color}11;border-radius:10px;overflow:hidden">
            <summary style="padding:10px 14px;font-size:12px;font-weight:700;color:${config.text_color}77;cursor:pointer;background:${config.text_color}04;list-style:none;display:flex;align-items:center;gap:6px">
              <i data-lucide="history" style="width:13px;height:13px"></i>
              Session History ${c.chatMessages?'('+c.chatMessages.length+' messages)':''}
              ${c.sessionRating?`<span style="margin-left:auto;color:#ffb300">${stars(c.sessionRating)}</span>`:''}
            </summary>
            <div style="padding:10px 14px;font-size:12px;color:${config.text_color}77;line-height:1.7">
              <div><strong>Submitted:</strong> ${c.timestamp?new Date(c.timestamp).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'-'}</div>
              ${c.gradeLevel?`<div><strong>Grade:</strong> ${_esc(c.gradeLevel)}</div>`:''}
              ${c.strand?`<div><strong>Strand:</strong> ${_esc(c.strand)}</div>`:''}
              ${c.age?`<div><strong>Age:</strong> ${ageLabel(c.age)}</div>`:''}
              ${c.contactPref?`<div><strong>Preferred Contact:</strong> ${c.contactPref==='meet'?'📹 Google Meet':c.contactPref==='facetoface'?'🏫 Face to Face':c.contactPref==='phone'?'📱 Phone':' 💬 Chat'}</div>`:''}
              ${c.referredTo?`<div><strong>Referred to:</strong> ${_esc(c.referredTo)}</div>`:''}
              ${c.meetScheduledAt?`<div><strong>Meet scheduled by:</strong> ${_esc(c.meetScheduledBy||'Guidance')} on ${new Date(c.meetScheduledAt).toLocaleDateString()}</div>`:''}
              ${c.reminderSentAt?`<div><strong>Reminder sent:</strong> ${new Date(c.reminderSentAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div>`:''}
              ${c.sessionRating?`<div><strong>Session rating:</strong> ${stars(c.sessionRating)} ${c.sessionFeedback?'— "'+_esc(c.sessionFeedback)+'"':''}</div>`:''}
            </div>
          </details>`:''}

          <!-- Chat Thread -->
          <div style="border-top:1px solid ${config.text_color}11;padding-top:12px;margin-top:4px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
              <i data-lucide="message-square" style="width:14px;height:14px;color:${config.text_color}55"></i>
              <span style="font-size:12px;font-weight:700;color:${config.text_color}66;text-transform:uppercase;letter-spacing:.05em">${tr('chatTitle')}</span>
              
            </div>
            <div id="consultChatBox_${c.id}" class="chat-scroll" style="min-height:60px;max-height:260px;margin-bottom:10px;padding:8px;border-radius:10px;background:${config.background_color}"><div class="chat-list">
              ${c.chatMessages&&c.chatMessages.length?c.chatMessages.map(m=>renderConsultChatMsg(m,c)).join(''):'<div style="text-align:center;padding:16px 0;font-size:12px;color:'+config.text_color+'88">'+tr('noMsgs')+' '+(isPending?tr('startBelow'):'')+'</div>'}
            </div></div>
            ${typingLine(c)}
            ${currentRole==='guidance'?`<div class="mb-2">${templatePicker('c', c.id)}</div>`:''}
            ${isPending||currentRole==='guidance'?`
            <div style="display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;gap:8px">
                <input id="consultChat_${c.id}" type="text" maxlength="1000" value="${_esc(consultationChatDraft[c.id]||'')}"
                  aria-label="${currentRole==='guidance'?'Reply to student':'Message the counselor'}"
                  placeholder="${currentRole==='guidance'?'Reply to student...':tr('msgCounselor')}"
                  oninput="consultationChatDraft['${c.id}']=this.value;noteTyping('${c.id}')"
                  onkeydown="if(event.key==='Enter'){event.preventDefault();sendConsultationChat('${c.id}')}"
                  style="flex:1;padding:9px 14px;border:1px solid ${config.text_color}22;border-radius:22px;background:${config.background_color};color:${config.text_color};font-size:13px;outline:none" />
                <button onclick="sendConsultationChat('${c.id}')"
                  style="padding:9px 16px;background:${currentRole==='guidance'?'#1565c0':config.primary_action_color};color:${currentRole==='guidance'?'#fff':'#2c3e50'};border-radius:22px;font-weight:700;font-size:13px;white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:6px">
                  <i data-lucide="send" style="width:14px;height:14px"></i> ${tr('send')}
                </button>
              </div>
              <!-- File Attachment Row -->
              ${(()=>{
                const storageBlocked = storageStats && !storageStats.error && (storageStats.level==='critical'||storageStats.level==='warning');
                const blockColor = storageStats&&storageStats.level==='critical'?'#c62828':'#e65100';
                const blockBg    = storageStats&&storageStats.level==='critical'?'#ffebee':'#fff3e0';
                const blockIcon  = storageStats&&storageStats.level==='critical'?'🚨':'🔶';
                const blockMsg   = storageStats&&storageStats.level==='critical'?'Attachments disabled — storage critical':'Attachments disabled — storage over 50%';
                return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${storageBlocked?`
                  <div style="display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid ${blockColor}44;color:${blockColor};background:${blockBg};cursor:not-allowed;opacity:0.85">
                    <i data-lucide="paperclip" style="width:13px;height:13px"></i> ${blockIcon} ${blockMsg}
                  </div>`:`
                  <label style="display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1px dashed ${config.text_color}33;color:${config.text_color}77;background:${config.text_color}05">
                    <i data-lucide="paperclip" style="width:13px;height:13px"></i> ${tr('attach')}
                    <input id="attachInput_${c.id}" type="file" accept="image/*,.pdf,.doc,.docx" style="display:none" onchange="sendConsultAttachment('${c.id}')" />
                  </label>`}
                <span style="font-size:11px;color:${storageBlocked?blockColor:config.text_color+'44'}">${(c.chatMessages||[]).filter(m=>m.isAttachment).length}/${ATTACH_MAX_PER_CONSULT} files used</span>`;
              })()}
                ${currentRole==='guidance'&&c.meetDateTime?`
                <button onclick="sendMeetReminder('${c.id}')"
                  style="margin-left:auto;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#e8f5e9;color:#2e7d32;border:1px solid #66bb6a55;cursor:pointer">
                  Send reminder
                </button>`:''}
              </div>
            </div>`:`
            <div>
              <p style="font-size:12px;color:${config.text_color}88;text-align:center;margin-bottom:10px">${tr('chatClosed')}</p>
              <!-- Post-session rating (student only, if not yet rated) -->
              ${currentRole==='student'&&!c.sessionRating?`
              <div class="p-3 rounded-xl" style="background:#fff8e1;border:1px solid #ffecb355">
                <div style="font-size:13px;font-weight:700;color:#bf360c;margin-bottom:8px">Rate your session</div>
                <div style="display:flex;gap:6px;margin-bottom:8px">
                  ${[1,2,3,4,5].map(n=>`<button onclick="consultSessionRating['${c.id}']=${n};render()" aria-label="${n} star${n>1?'s':''}" aria-pressed="${(consultSessionRating[c.id]||0)>=n}" style="font-size:26px;line-height:1;padding:2px;color:#ff8f00;background:none;border:none;cursor:pointer;opacity:${(consultSessionRating[c.id]||0)>=n?'1':'0.45'}">${(consultSessionRating[c.id]||0)>=n?'★':'☆'}</button>`).join('')}
                </div>
                <input type="text" placeholder="Optional: share your thoughts..." aria-label="Optional comment" maxlength="500" oninput="consultSessionFeedback['${c.id}']=this.value" value="${_esc(consultSessionFeedback[c.id]||'')}"
                  style="width:100%;padding:8px 12px;border:1px solid #ffcc0244;border-radius:8px;background:#fff;color:#333;font-size:13px;margin-bottom:8px" />
                <button onclick="submitSessionRating('${c.id}')" style="padding:7px 16px;border-radius:20px;font-size:12px;font-weight:700;background:#ff8f00;color:#fff;border:none;cursor:pointer">Submit Rating</button>
              </div>`:''}
              ${c.sessionRating?`<div style="text-align:center;font-size:13px;color:${darkMode?'#a5d6a7':'#2e7d32'}">${currentRole==='student'?'You rated this session':'Student rating'}: ${stars(c.sessionRating)}</div>`:''}
            </div>`}
          </div>
        </div>`)
      }).join('')}
    ${visibleConsultations.length > consultLimit ? `<button onclick="consultLimit+=25;render()" class="w-full py-3 rounded-lg text-sm font-semibold" style="background:${config.text_color}11;color:${config.text_color}">Show more (${visibleConsultations.length - consultLimit} remaining)</button>` : ''}
  </div>
</div>`;
      }

      // ── USERS (admin) ──
      if(activeSidebarItem==='Users'&&currentRole==='admin') return `
<div class="max-w-4xl">
  <div class="flex justify-between items-center mb-8"><div><h1 class="font-bold" style="font-size:${fs*1.4}px;color:${config.text_color}">User Management</h1><p class="text-sm mt-1" style="color:${config.text_color}66">Create Admin or Guidance accounts • Only Admins can access this page</p></div></div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
    <div class="p-6 rounded-xl card-hover" style="background:${config.surface_color}"><div class="flex items-center gap-3 mb-4"><i data-lucide="shield" style="width:28px;height:28px;color:#90caf9"></i><h3 class="font-bold" style="color:${config.text_color}">Create New Admin</h3></div><input type="email" id="newAdminEmail" placeholder="admin@qhsafety.edu" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color}" /><input type="password" id="newAdminPassword" placeholder="Password (min 6 chars)" style="width:100%;padding:12px;margin-bottom:16px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color}" /><button onclick="createAdminAccount()" class="w-full py-3 rounded-lg font-semibold" style="background:#90caf9;color:#2c3e50">Create Admin Account</button></div>
    <div class="p-6 rounded-xl card-hover" style="background:${config.surface_color}"><div class="flex items-center gap-3 mb-4"><i data-lucide="users" style="width:28px;height:28px;color:#ffee58"></i><h3 class="font-bold" style="color:${config.text_color}">Create New Guidance Counselor</h3></div><input type="email" id="newGuidanceEmail" placeholder="counselor@qhsafety.edu" style="width:100%;padding:12px;margin-bottom:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color}" /><input type="password" id="newGuidancePassword" placeholder="Password (min 6 chars)" style="width:100%;padding:12px;margin-bottom:16px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color}" /><button onclick="createGuidanceAccount()" class="w-full py-3 rounded-lg font-semibold" style="background:${config.primary_action_color};color:#2c3e50">Create Guidance Account</button></div>
  </div>

  <!-- ── ACCOUNT CHECKER ── -->
  <div class="p-6 rounded-xl mb-6" style="background:${config.surface_color};border:2px solid ${config.primary_action_color}33">
    <div class="flex items-center gap-3 mb-1">
      <i data-lucide="search" style="width:22px;height:22px;color:${config.primary_action_color}"></i>
      <h3 class="font-bold" style="color:${config.text_color};font-size:${fs*1.05}px">Account Checker & Role Fixer</h3>
    </div>
    <p class="text-sm mb-5" style="color:${config.text_color}66">Verify whether an account has the correct Firestore role, and fix it instantly if not.</p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;color:${config.text_color}88;margin-bottom:6px">EMAIL</label>
        <input type="email" id="acEmail" placeholder="user@example.com"
          style="width:100%;padding:10px 12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:14px" />
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;color:${config.text_color}88;margin-bottom:6px">PASSWORD</label>
        <input type="password" id="acPassword" placeholder="••••••••"
          style="width:100%;padding:10px 12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:14px" />
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;color:${config.text_color}88;margin-bottom:6px">EXPECTED ROLE</label>
        <select id="acRole"
          style="width:100%;padding:10px 12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:14px">
          <option value="">— just check —</option>
          <option value="student">Student</option>
          <option value="guidance">Guidance Counselor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </div>
    <div class="flex gap-3 mb-4">
      <button onclick="adminCheckAccount()" id="acCheckBtn"
        style="padding:10px 22px;border-radius:8px;background:${config.primary_action_color};color:#2c3e50;border:none;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px">
        <i data-lucide="search" style="width:15px;height:15px"></i> Check Account
      </button>
      <button onclick="adminFixAccount()" id="acFixBtn" data-live
        style="padding:10px 22px;border-radius:8px;background:#f57f17;color:#fff;border:none;font-weight:700;font-size:14px;cursor:pointer;display:none;align-items:center;gap:6px">
        <i data-lucide="wrench" style="width:15px;height:15px"></i> Fix Role
      </button>
    </div>
    <div id="acResult" data-live style="display:none;padding:14px;border-radius:10px;font-size:13px;line-height:1.7"></div>
  </div>

  <div class="p-6 rounded-xl" style="background:${config.surface_color}"><p style="color:${config.text_color}88">• New accounts are created immediately.<br>• Only these credentials will allow login with the correct role.</p></div>
</div>`;


      // ── FEEDBACK ──
      if(activeSidebarItem==='Feedback') {
        const visibleFeedback=currentRole==='admin'?feedbackList:feedbackList.filter(f=>f.author===myEmail);
        return `
        <div class="max-w-3xl">
  ${currentRole === 'admin' && feedbackList.length ? `
  <div class="mb-4 flex" style="justify-content:flex-end">
    <button onclick="deleteAllFeedback()" class="btn-danger-ghost"><i data-lucide="trash-2" style="width:14px;height:14px"></i>${tr('deleteAllFeedback')}</button>
  </div>` : ''}
  ${currentRole!=='admin'?`<div class="mb-8"><button onclick="showFeedbackForm=!showFeedbackForm;render()" class="px-6 py-3 rounded-lg font-semibold flex items-center gap-2" style="background:${config.primary_action_color};color:#2c3e50"><i data-lucide="plus" style="width:20px;height:20px"></i> ${tr('leaveFeedback')}</button></div>`:''}
  ${showFeedbackForm?`<div data-key="fb-form" class="p-6 rounded-xl mb-8 fade-in" style="background:${config.surface_color};border:1px solid ${config.text_color}11">${feedbackError?`<div class="p-3 rounded-lg mb-4 text-sm" role="alert" style="background:#fdecea;color:#b71c1c;border:1px solid #ef9a9a;text-align:center">${feedbackError}</div>`:''}<h3 class="font-bold mb-4" style="font-size:${fs*1.1}px;color:${config.text_color}">${tr('leaveFeedback')}</h3><div class="mb-4"><label style="display:block;font-size:14px;font-weight:600;color:${config.text_color};margin-bottom:8px">${tr('rating')}</label><div class="flex gap-2">${[1,2,3,4,5].map(n=>`<button onclick="feedbackRating=${n};render()" aria-label="${n} star${n>1?'s':''}" aria-pressed="${feedbackRating>=n}" class="w-10 h-10 rounded-lg text-lg" style="text-align:center;background:${feedbackRating>=n?config.primary_action_color:config.text_color+'14'};color:${feedbackRating>=n?'#2c3e50':config.text_color+'88'}">★</button>`).join('')}</div></div><textarea placeholder="${tr('writeFeedback')}" aria-label="${tr('writeFeedback')}" maxlength="1500" oninput="feedbackMessage=this.value" style="width:100%;padding:12px;margin-bottom:16px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};min-height:100px;resize:vertical">${_esc(feedbackMessage)}</textarea><div class="flex gap-3"><button onclick="addFeedback()" class="px-6 py-3 rounded-lg font-semibold" style="background:${config.primary_action_color};color:#2c3e50">${tr('submit')}</button><button onclick="showFeedbackForm=false;feedbackMessage='';feedbackRating=5;feedbackError='';render()" class="px-6 py-3 rounded-lg font-semibold" style="background:${config.text_color}22;color:${config.text_color}">${tr('cancel')}</button></div></div>`:''}
  <div class="space-y-4">
    ${visibleFeedback.length===0?`<div class="p-8 rounded-xl flex flex-col items-center" style="background:${config.surface_color};border:2px dashed ${config.text_color}22"><i data-lucide="message-circle" style="width:32px;height:32px;color:${config.text_color}44"></i><p class="mt-3 text-sm" style="color:${config.text_color}99">${dataLoaded.feedback ? tr('noFeedback') : tr('loading')}</p></div>`:visibleFeedback.map(f=>`<div class="p-6 rounded-xl" style="background:${config.surface_color};border:1px solid ${config.text_color}11"><div class="flex justify-between items-start mb-2"><div><span class="text-xs font-bold" style="color:${config.text_color}99">${_esc(f.authorRole||'Student')}</span><div class="flex gap-1 mt-1">${[1,2,3,4,5].map(n=>`<span style="color:${f.rating>=n?'#f9a825':config.text_color+'33'};font-size:14px">★</span>`).join('')}</div></div><span class="text-xs" style="color:${config.text_color}88">${_esc(f.date||'')}</span></div><p style="color:${config.text_color}cc;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere">${_esc(f.message)}</p></div>`).join('')}
  </div>
</div>`;
      }

      // ── LOGS (admin) ──
      if(activeSidebarItem==='Logs'&&currentRole==='admin') {
        const filtered=logFilter==='all'?systemLogs:systemLogs.filter(l=>l.type===logFilter);
        return `
<div class="max-w-4xl">
  <div class="flex justify-between items-center mb-6 flex-wrap gap-3">
    <h1 class="font-bold" style="font-size:${fs*1.4}px;color:${config.text_color}">System Logs</h1>
    <div class="flex gap-2 flex-wrap">${['all','info','warning','error','success'].map(t=>`<button onclick="logFilter='${t}';render()" class="px-3 py-1.5 rounded-lg text-xs font-semibold" style="background:${logFilter===t?config.primary_action_color:config.text_color+'14'};color:${logFilter===t?'#2c3e50':config.text_color}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('')}</div>
  </div>
  <div class="space-y-2">${filtered.length===0?`<div class="p-8 rounded-xl text-center" style="background:${config.surface_color}"><p style="color:${config.text_color}66">No logs found</p></div>`:filtered.map(l=>`<div class="p-4 rounded-xl flex items-start gap-3" style="background:${config.surface_color}"><div class="w-2 h-2 rounded-full mt-2 shrink-0" style="background:${l.type==='error'?'#ef5350':l.type==='warning'?'#ff9800':l.type==='success'?'#66bb6a':'#90caf9'}"></div><div class="flex-1 min-w-0"><p class="text-sm" style="color:${config.text_color};overflow-wrap:anywhere">${_esc(l.action)}</p><p class="text-xs mt-1" style="color:${config.text_color}88">${_esc(maskEmail(String(l.user||'')))} · ${_esc(l.time||'')}</p></div></div>`).join('')}</div>
</div>`;
      }



      // ── SETTINGS ──
      if(activeSidebarItem==='Settings') return `
<div class="max-w-xl">
  ${installCard()}${templatesCard()}
  <div class="p-6 rounded-xl mb-6" style="background:${config.surface_color}">
    <h3 class="font-bold mb-4" style="color:${config.text_color}">${tr('appearance')}</h3>
    <div class="flex items-center justify-between p-4 rounded-lg mb-3" style="background:${config.text_color}08">
      <div class="flex items-center gap-3">
        <i data-lucide="${darkMode?'moon':'sun'}" style="width:20px;height:20px;color:${config.text_color}"></i>
        <span style="font-weight:600;color:${config.text_color}">${tr('darkMode')}</span>
      </div>
      <button role="switch" aria-checked="${darkMode}" aria-label="${tr('darkMode')}" onclick="darkMode=!darkMode;localStorage.setItem('qh_dark_mode',darkMode);render()" class="qh-switch ${darkMode?'on':''}"><span></span></button>
    </div>
    <div class="p-4 rounded-lg" style="background:${config.text_color}08">
      <div class="flex items-center gap-3 mb-3">
        <i data-lucide="languages" style="width:20px;height:20px;color:${config.text_color}"></i>
        <span style="font-weight:600;color:${config.text_color}">${tr('langSetting')}</span>
      </div>
      <div class="flex gap-2">
        <button onclick="appLang='en';localStorage.setItem('qh_lang','en');render()"
          style="flex:1;padding:10px;border-radius:8px;font-weight:700;font-size:13px;border:2px solid ${appLang==='en'?config.primary_action_color:'transparent'};background:${appLang==='en'?config.primary_action_color+'33':'transparent'};color:${config.text_color}">
          English
        </button>
        <button onclick="appLang='tl';localStorage.setItem('qh_lang','tl');render()"
          style="flex:1;padding:10px;border-radius:8px;font-weight:700;font-size:13px;border:2px solid ${appLang==='tl'?config.primary_action_color:'transparent'};background:${appLang==='tl'?config.primary_action_color+'33':'transparent'};color:${config.text_color}">
          Filipino
        </button>
      </div>
    </div>
  </div>
  <div class="p-6 rounded-xl mb-6" style="background:${config.surface_color}">
    <div class="flex items-center gap-3 mb-4">
      <i data-lucide="bell" style="width:20px;height:20px;color:${config.primary_action_color}"></i>
      <h3 class="font-bold" style="color:${config.text_color}">Push Notifications</h3>
    </div>
    <div id="settings-notif-status" class="p-3 rounded-lg mb-4 flex items-center gap-2" style="background:${config.text_color}08;border:1px solid ${config.text_color}11">
      <span id="settings-notif-icon" data-live style="font-size:16px">🔔</span>
      <span id="settings-notif-label" data-live class="text-sm" style="color:${config.text_color}aa">Checking notification status…</span>
    </div>
    <button id="settings-notif-btn" data-live onclick="enablePushNotifications()" class="px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2" style="background:#ffee58;color:#2c3e50;border:none;cursor:pointer">
      <i data-lucide="bell-ring" style="width:16px;height:16px"></i>
      Enable Push Notifications
    </button>
    <p class="text-xs mt-3" style="color:${config.text_color}55">Get real-time alerts even when the app is closed. ${currentRole==='guidance'?'You will be notified of high-risk student submissions.':'You will receive announcements from the guidance office.'}</p>
  </div>
  <div class="p-6 rounded-xl" style="background:${config.surface_color}">
    <h3 class="font-bold mb-2" style="color:${config.text_color}">${tr('account')}</h3>
    ${isAnonymous?`
    <div class="flex items-center gap-2 mb-3 p-3 rounded-lg" style="background:#90a4ae22;border:1px solid #90a4ae44">
      <i data-lucide="eye-off" style="width:16px;height:16px;color:#90a4ae"></i>
      <span class="text-sm font-semibold" style="color:${config.text_color}88">${tr('signedInAs')}</span>
    </div>
    <p class="text-sm mb-4" style="color:${config.text_color}66">${tr('anonNote')}</p>
    <button onclick="logout()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:#90a4ae;color:#fff">${tr('leaveAnon')}</button>`:`
    <p class="text-sm mb-4" style="color:${config.text_color}aa;overflow-wrap:anywhere">${tr('loggedInAs')} <strong>${_esc(currentUserEmail)}</strong> (${_esc(currentRole)})</p>
    <button onclick="logout()" class="px-4 py-2 rounded-lg font-semibold text-sm" style="background:#ef5350;color:#fff">${tr('logout')}</button>`}
  </div>
</div>`;

      // ── PROBLEMS (guidance) ──
      if(activeSidebarItem==='Problems'&&currentRole==='guidance') {
        const problemConsultations=[...consultationPostings]
          .filter(c=>c.status==='Pending')
          .map(c=>({...c,_type:'consultation',aiScore:Number(c.aiScore||0),priority:(c.priority||'Medium').trim(),riskLevel:(c.riskLevel||'Low').trim()}))
          // AI must have verified High risk — priority alone is NOT sufficient
          .filter(c=>c.riskLevel==='High'||c.riskLevel==='Medium')
          .sort((a,b)=>getUrgencyScore(b)-getUrgencyScore(a));
        const problemPostings=[...postings]
          .map(p=>({...p,_type:'posting',aiScore:Number(p.aiScore||0),priority:(p.priority||'Medium').trim(),riskLevel:(p.riskLevel||'Low').trim()}))
          // AI must have verified High risk — priority alone is NOT sufficient
          .filter(p=>p.riskLevel==='High'||p.riskLevel==='Medium')
          .sort((a,b)=>getUrgencyScore(b)-getUrgencyScore(a));
        const totalCount=problemConsultations.length+problemPostings.length;
        return `
<div class="max-w-3xl">
  ${overdueBanner()}
  <div class="mb-6 p-4 rounded-xl flex items-center gap-3" style="background:${config.primary_action_color}22;border:1px solid ${config.primary_action_color}44">
    <i data-lucide="alert-triangle" style="width:20px;height:20px;color:#f57c00"></i>
    <span style="color:${config.text_color};font-weight:600">${totalCount} ${appLang==='tl'?'item':'item'}${totalCount!==1&&appLang!=='tl'?'s':''} ${appLang==='tl'?'nangangailangan ng pansin':'require attention'} &mdash; ${problemConsultations.length} ${appLang==='tl'?'konsultasyon':'consultation'}${problemConsultations.length!==1&&appLang!=='tl'?'s':''}, ${problemPostings.length} ${appLang==='tl'?'post':'posting'}${problemPostings.length!==1&&appLang!=='tl'?'s':''}</span>
  </div>
  ${totalCount===0?`<div class="p-8 rounded-xl flex flex-col items-center" style="background:${config.surface_color};border:2px dashed ${config.text_color}22"><i data-lucide="check-circle" style="width:32px;height:32px;color:#66bb6a"></i><p class="mt-3 text-sm" style="color:${config.text_color}66">${appLang==='tl'?'Walang problema! Walang medium o high risk na item.':'All clear! No medium or high risk items.'}</p></div>`:''}
  ${problemConsultations.length>0?`
  <div class="mb-3 flex items-center gap-2"><i data-lucide="users" style="width:14px;height:14px;color:${config.text_color}55"></i><span class="text-xs font-bold uppercase tracking-widest" style="color:${config.text_color}55">${appLang==='tl'?'Mga Nakabinbing Konsultasyon':'Pending Consultations'}</span></div>
  <div class="space-y-4 mb-8">
    ${problemConsultations.map(c=>{const gc=getGlowClass(c,true);return `
    <div class="p-6 rounded-xl ${gc}" style="background:${config.surface_color};border:1px solid ${config.text_color}11">
      <div class="flex justify-between items-start mb-2">
        <div>
          <div class="mb-1"><span class="text-xs px-2 py-0.5 rounded font-bold" style="background:#90caf922;color:#5c9be0;border:1px solid #90caf944">${appLang==='tl'?'Konsultasyon':'Consultation'}</span></div>
          <h3 class="font-bold" style="color:${config.text_color}">${_esc(c.reason)}</h3>
          <div class="flex gap-2 mt-1 flex-wrap">
            <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:${c.priority==='High'?'#ef5350':c.priority==='Medium'?'#ff9800':'#66bb6a'};color:#fff">${c.priority==='High'?'⚡':c.priority==='Medium'?'▲':'▽'} ${tr(c.priority.toLowerCase())} ${appLang==='tl'?'Prioridad':'Priority'}</span>
            <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:${c.riskLevel==='High'?'#ef5350':c.riskLevel==='Medium'?'#ff9800':'#66bb6a'};color:#fff">${c.riskLevel==='High'?'🔴':c.riskLevel==='Medium'?'🟠':'🟢'} ${c.riskLevel} Risk · AI:${c.aiScore}</span>
          </div>
        </div>
        <div class="flex gap-2 shrink-0"><button onclick="goTo('Consultations')" class="text-xs px-3 py-1.5 rounded-lg font-semibold" style="background:${config.text_color}14;color:${config.text_color}">Open</button><button onclick="updateConsultationStatus('${c.id}')" class="text-xs px-3 py-1.5 rounded-lg font-semibold" style="background:${config.secondary_action_color};color:#2c3e50">${tr('markDone')}</button></div>
      </div>
      <p class="text-sm mb-2" style="color:${config.text_color}cc;white-space:pre-wrap;overflow-wrap:anywhere">${_esc(c.description)}</p>
      <p class="text-xs" style="color:${config.text_color}55">${appLang==='tl'?'Estudyante:':'Student:'} ${_esc(c.studentEmail||c.author)} · ${_esc(c.date||'')}</p>
    </div>`;}).join('')}
  </div>`:''}
  ${problemPostings.length>0?`
  <div class="mb-3 flex items-center gap-2"><i data-lucide="megaphone" style="width:14px;height:14px;color:${config.text_color}55"></i><span class="text-xs font-bold uppercase tracking-widest" style="color:${config.text_color}55">${appLang==='tl'?'Mga Naka-flag na Post':'Flagged Postings'}</span></div>
  <div class="space-y-4">
    ${problemPostings.map(p=>{const gc=getGlowClass(p,true);return `
    <div class="p-6 rounded-xl ${gc}" style="background:${config.surface_color};border:1px solid ${config.text_color}11">
      <div class="mb-2">
        <div class="mb-1"><span class="text-xs px-2 py-0.5 rounded font-bold" style="background:#ffee5822;color:#9a8000;border:1px solid #ffee5855">${appLang==='tl'?'Post':'Posting'}</span></div>
        <h3 class="font-bold" style="color:${config.text_color}">${_esc(p.title)}</h3>
        <div class="flex gap-2 mt-1 flex-wrap">
          <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:${p.priority==='High'?'#ef5350':p.priority==='Medium'?'#ff9800':'#66bb6a'};color:#fff">${p.priority==='High'?'⚡':p.priority==='Medium'?'▲':'▽'} ${p.priority} Priority</span>
          <span class="text-xs px-2 py-0.5 rounded-full font-bold" style="background:${p.riskLevel==='High'?'#ef5350':p.riskLevel==='Medium'?'#ff9800':'#66bb6a'};color:#fff">${p.riskLevel==='High'?'🔴':p.riskLevel==='Medium'?'🟠':'🟢'} ${p.riskLevel} Risk · AI:${p.aiScore}</span>
          ${p.reasons&&p.reasons.length?`<span class="text-xs px-2 py-0.5 rounded-full font-semibold" style="background:#ef535018;color:#ef5350">${_esc(p.reasons[0])}${p.reasons.length>1?' +'+(p.reasons.length-1)+' more':''}</span>`:''}
        </div>
      </div>
      <p class="text-sm mb-2" style="color:${config.text_color}cc;white-space:pre-wrap;overflow-wrap:anywhere">${_esc(p.content)}</p>
      <p class="text-xs" style="color:${config.text_color}55">${appLang==='tl'?'Ni':'By'}: ${_esc(p.author)} · ${p.timestamp?new Date(p.timestamp).toLocaleDateString():''}</p>
    </div>`;}).join('')}
  </div>`:''}
</div>`;
      }

      // ── DASHBOARD ──
      return `
${overdueBanner()}
${severeSummary()}
${followUpPanel()}
${moodCard()}
<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
  ${currentRole!=='admin'?`<div class="p-6 rounded-xl card-hover" style="background:${config.surface_color}"><div class="flex items-center gap-3 mb-2"><i data-lucide="megaphone" style="width:20px;height:20px;color:${config.primary_action_color}"></i><span class="font-semibold" style="color:${config.text_color}">${tr('postings')}</span></div><p class="text-3xl font-bold" style="color:${config.text_color}">${isGuidance?postings.length:postings.filter(p=>p.author===currentUserEmail).length}</p><p class="text-sm mt-1" style="color:${config.text_color}66">${isGuidance?tr('totalPosted'):tr('yourPosts')}</p></div>`:''}
  ${currentRole!=='admin'?`<div class="p-6 rounded-xl card-hover" style="background:${config.surface_color}"><div class="flex items-center gap-3 mb-2"><i data-lucide="users" style="width:20px;height:20px;color:${config.secondary_action_color}"></i><span class="font-semibold" style="color:${config.text_color}">${tr('consultations')}</span></div><p class="text-3xl font-bold" style="color:${config.text_color}">${isGuidance?consultationPostings.length:consultationPostings.filter(c=>c.author===currentUserEmail||c.studentEmail===currentUserEmail).length}</p><p class="text-sm mt-1" style="color:${config.text_color}66">${isGuidance?tr('totalRequests'):tr('yourRequests')}</p></div>`:''}
  <div class="p-6 rounded-xl card-hover" style="background:${config.surface_color}"><div class="flex items-center gap-3 mb-2"><i data-lucide="message-circle" style="width:20px;height:20px;color:#90caf9"></i><span class="font-semibold" style="color:${config.text_color}">${tr('feedback')}</span></div><p class="text-3xl font-bold" style="color:${config.text_color}">${currentRole==='admin'?feedbackList.length:feedbackList.filter(f=>f.author===currentUserEmail).length}</p><p class="text-sm mt-1" style="color:${config.text_color}66">${currentRole==='admin'?tr('totalFeedback'):tr('yourFeedback')}</p></div>
  ${isGuidance?`<div class="p-6 rounded-xl card-hover" role="button" tabindex="0" onclick="goTo('Problems')" onkeydown="if(event.key==='Enter')goTo('Problems')" style="cursor:pointer;background:#ef535011;border:1px solid #ef535033"><div class="flex items-center gap-3 mb-2"><i data-lucide="alert-triangle" style="width:20px;height:20px;color:#ef5350"></i><span class="font-semibold" style="color:${config.text_color}">${tr('problems')}</span></div><p class="text-3xl font-bold" style="color:#ef5350">${consultationPostings.filter(c=>c.status==='Pending'&&(c.riskLevel==='High'||c.riskLevel==='Medium')).length+postings.filter(p=>p.riskLevel==='High'||p.riskLevel==='Medium').length}</p><p class="text-sm mt-1" style="color:${config.text_color}66">${tr('needAttention')}</p></div>`:''}
</div>
<div class="p-6 rounded-xl" style="background:${config.surface_color}">
  <h3 class="font-bold mb-1" style="color:${config.text_color}">${tr('welcomeMsg')}</h3>
  <p style="color:${config.text_color}88;font-size:14px">${currentRole==='student'?tr('dashHint_student'):isGuidance?tr('dashHint_guidance'):tr('dashHint_admin')}</p>
</div>
${announcementsBoard()}
${isGuidance?`
<div class="p-6 rounded-xl mt-6" style="background:${config.surface_color};border:1px solid #90caf933">
  <div class="flex items-center gap-3 mb-4">
    <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:#90caf922">
      <i data-lucide="megaphone" style="width:18px;height:18px;color:#90caf9"></i>
    </div>
    <div>
      <h3 class="font-bold" style="color:${config.text_color}">Send announcement to students</h3>
      <p class="text-xs" style="color:${config.text_color}66">Push notification delivered to all subscribed students</p>
    </div>
  </div>
  <input id="announcement-title-input" type="text" placeholder="Announcement title..." aria-label="Announcement title" maxlength="120" value="${_esc(announcementTitle)}"
    onkeydown="if(event.key==='Enter'){event.preventDefault();}" oninput="announcementTitle=this.value;onFieldInput()"
    style="width:100%;padding:10px 14px;margin-bottom:10px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:14px" />
  <textarea id="announcement-msg-input" aria-label="Announcement message" maxlength="500" placeholder="Write your message to all students..." oninput="announcementMessage=this.value;onFieldInput()"
    style="width:100%;padding:10px 14px;margin-bottom:12px;border:1px solid ${config.text_color}22;border-radius:8px;background:${config.background_color};color:${config.text_color};font-size:14px;min-height:80px;resize:vertical">${_esc(announcementMessage)}</textarea>
  <button id="announcement-send-btn" onclick="handleSendAnnouncement()" ${announcementBusy?'disabled':''}
    style="padding:10px 20px;background:#90caf9;color:#1a237e;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px">
    ${announcementBusy?spinner+'Sending…':'<i data-lucide="send" style="width:16px;height:16px"></i> Send to all students'}
  </button>
  <div style="margin-top:12px">
    <span id="announcement-status" data-live role="status" style="display:none;font-size:12px;font-weight:700;color:#1565c0"></span>
    <div id="announcement-result" data-live style="display:none;text-align:center;margin-top:10px"></div>
  </div>
</div>`:''}`;
    }

    // ── DEEP LINK HANDLER ──
    // When counselor taps a OneSignal push notification, the URL contains
    // ?deeplink=posting&id=123&risk=High&score=18
    // This handler waits for auth + data to load, then auto-navigates.
    let _deepLinkBusy = false;
    function handleDeepLink() {
      if (_deepLinkBusy) return;
      const params = new URLSearchParams(window.location.search);
      const type  = params.get('deeplink');
      const id    = params.get('id');
      const risk  = params.get('risk');
      const score = params.get('score');
      if (!type || !id) return;

      // ── Validate params to prevent injection via crafted URLs ──
      const safeTypes = ['posting', 'consultation'];
      if (!safeTypes.includes(type)) return;          // only known types
      if (!/^\d+$/.test(id)) return;                  // id must be digits only
      const safeRisk  = ['Low','Low-Medium','Medium','High'].includes(risk) ? risk : 'High';
      const safeScore = /^\d+$/.test(score) ? score : '?';

      // Poll until data is loaded and user is authenticated as guidance
      _deepLinkBusy = true;
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        if (attempts > 30) { clearInterval(check); _deepLinkBusy = false; return; } // timeout after 15s

        const isReady = isAuthenticated && currentRole === 'guidance' &&
          (type === 'posting' ? postings.length > 0 : consultationPostings.length > 0);
        if (!isReady) return;
        clearInterval(check);

        // Navigate to the correct section
        activeSidebarItem = type === 'posting' ? 'Postings' : 'Consultations';
        postLimit = Math.max(postLimit, 150); consultLimit = Math.max(consultLimit, 150);   // make sure the linked item is on the page
        postingSearchQuery = '';
        render();

        // Scroll to the specific post — poll until element appears in DOM
        let scrollAttempts = 0;
        const scrollCheck = setInterval(() => {
          scrollAttempts++;
          if (scrollAttempts > 20) { clearInterval(scrollCheck); return; }
          const el = document.querySelector(type === 'posting' ? `[data-post-id="${id}"]` : `[data-consult-id="${id}"]`);
          if (el) {
            clearInterval(scrollCheck);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.outline = '3px solid #ef5350';
            setTimeout(() => { el.style.outline = ''; }, 3000);
          }
        }, 300);

        // Show a banner about why they're here
        setTimeout(() => {
          showModal(
            `🚨 ${_esc(safeRisk)} Risk Alert`,
            `AI Score: <strong>${_esc(safeScore)}</strong><br>A student submission was flagged and needs your attention. You have been brought directly to the item below.`,
            'error'
          );
        }, 400);

        // Clean up URL so refresh doesn't re-trigger
        window.history.replaceState({}, '', window.location.pathname);
        _deepLinkBusy = false;
      }, 500);
    }

    handleDeepLink();

    // ── AUTO-LOGIN via Firebase session ──
    auth.onAuthStateChanged(async (user) => {
      if (signInFlowActive) return;                       // an explicit sign-in is already handling this
      try {
        if (user && !isAuthenticated) {
          const savedRole = localStorage.getItem('qh_saved_role');
          if (user.isAnonymous) {
            if (savedRole === 'student') { _lastActive = Date.now(); enterAnonymous(user); }
          } else if (savedRole) {
            const email = (user.email || '').toLowerCase();
            // ── Authoritative role from Firestore (not email string heuristics) ──
            const actualRole = await resolveRoleFromFirestore(user.uid, email);
            if (savedRole === actualRole && !isAuthenticated && !signInFlowActive) {
              currentUserEmail = email;
              currentRole = actualRole; // trust Firestore, not localStorage
              isAuthenticated = true;
              activeSidebarItem = localStorage.getItem('qh_last_page') || 'Dashboard';
              if (actualRole === 'guidance') registerAsCounselor();
              _lastActive = Date.now(); loadSeen(); startOverdueWatch();
              loadDataFromFirestore();
              setTimeout(handleDeepLink, 1000);
            }
          }
        }
      } finally {
        booting = false;
        render();
      }
    });
    setTimeout(() => { if (booting) { booting = false; render(); } }, 6000);   // never sit on the splash forever
    resumeGoogleRedirect();

    render();
