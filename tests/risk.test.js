// Run with:  node tests/risk.test.js
// Checks the local risk rules and the language filter against tests/corpus.js.
const path = require('path');
const E = require(path.join(__dirname, '..', 'risk-engine.js'));
const corpus = require('./corpus.js');
const verbose = process.argv.includes('-v');
let fail = 0, n = 0;
const bad = (kind, c, got, why) => { fail++; console.log(kind + ' FAIL', JSON.stringify(c.t), '->', got, why || ''); };

for (const c of corpus.risk) {
  n++;
  const r = E.analyzeRisk(c.t), th = E.detectThreatToOthers(c.t), errs = [];
  if (c.min && E.levelRank(r.level) < E.levelRank(c.min)) errs.push('want >= ' + c.min);
  if (c.max && E.levelRank(r.level) > E.levelRank(c.max)) errs.push('want <= ' + c.max);
  if (c.threat === true && !th) errs.push('threat missed');
  if (c.threat === false && th) errs.push('false threat');
  if (errs.length) bad('RISK', c, r.level + ' ' + r.score + ' [' + r.reasons.join('; ') + ']', errs.join(', '));
  else if (verbose) console.log('ok  ', r.level.padEnd(10), String(r.score).padStart(2), c.t);
}
for (const c of corpus.profanity) { n++; const g = E.containsProfanity(c.t); if (g !== c.bad) bad('PROFANITY', c, g); }
for (const c of corpus.gate) { n++; const g = E.languageGate(c.t); if (g.block !== c.block) bad('GATE', c, JSON.stringify(g)); }

// The AI can never talk a clear threat down, and a local High never drops below Medium.
n++; { const r = E.applyFloors('I will kill someone', { score: 0, level: 'Low', flagged: false, reasons: [] });
  if (r.level !== 'High' || r.score < 16 || !r.flagged) bad('FLOOR', { t: 'threat floor' }, JSON.stringify(r)); }
n++; { const r = E.applyFloors('gusto ko nang mamatay', { score: 1, level: 'Low', flagged: false, reasons: [] });
  if (r.level !== 'High' || !r.flagged) bad('FLOOR', { t: 'direct intent floor' }, JSON.stringify(r)); }
n++; { const r = E.applyFloors('my stepfather hits me every night', { score: 0, level: 'Low', flagged: false, reasons: [] });
  if (E.levelRank(r.level) < E.levelRank('Medium') || !r.flagged) bad('FLOOR', { t: 'local-High floor' }, JSON.stringify(r)); }
n++; { const r = E.applyFloors('I hate math', { score: 9, level: 'Medium', flagged: true, reasons: ['x'] });
  if (r.level !== 'Medium') bad('FLOOR', { t: 'AI may raise' }, JSON.stringify(r)); }
n++; { const m = E.maskProfanity('tangina pagod na ako');
  if (!/^t\*+ pagod na ako$/.test(m)) bad('MASK', { t: 'mask' }, m); }

console.log(`\n${n - fail}/${n} passed` + (fail ? `, ${fail} FAILED` : ''));
process.exit(fail ? 1 : 0);
