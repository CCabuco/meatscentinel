// Password policy — D-06.
//
// Note on framing for the paper: ISO/IEC 25010 is a software product
// quality model and does not prescribe password rules. This policy
// SUPPORTS the Security characteristic, specifically its confidentiality
// and authenticity sub-characteristics. It is not required BY the
// standard. Use "supports", not "follows".

export const RULES = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (pw) => pw.length >= 8,
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter',
    test: (pw) => /[A-Z]/.test(pw),
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter',
    test: (pw) => /[a-z]/.test(pw),
  },
  {
    id: 'number',
    label: 'One number',
    test: (pw) => /[0-9]/.test(pw),
  },
  {
    id: 'special',
    label: 'One special character',
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

const DIFFERENT_RULE = {
  id: 'different',
  label: 'Different from your current password',
};

// Returns one entry per rule so the UI can show live feedback as the
// user types, rather than only reporting failure on submit.
export function evaluatePassword(password, currentPassword = null) {
  const pw = password ?? '';

  const results = RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(pw),
  }));

  // Only assert the "must differ" rule when a current password is
  // actually in play — it does not apply at account creation.
  if (currentPassword !== null) {
    results.push({
      ...DIFFERENT_RULE,
      met: pw.length > 0 && pw !== currentPassword,
    });
  }

  const metCount = results.filter((r) => r.met).length;

  return {
    results,
    valid: results.every((r) => r.met),
    metCount,
    total: results.length,
  };
}

export function strengthLabel(metCount, total) {
  if (total === 0 || metCount === 0) return { text: '', tone: 'none' };
  const ratio = metCount / total;
  if (ratio < 0.5) return { text: 'Weak', tone: 'weak' };
  if (ratio < 1) return { text: 'Almost there', tone: 'partial' };
  return { text: 'Meets requirements', tone: 'ok' };
}
