// Rice Bran-only QC oil reconciliation. Per the spec:
//   Oil Difference = JMD/Report Oil - QC Lab Oil
// and QC Oil is NEVER overwritten by the JMD/Report oil — both are kept.
// Palm Kernel/Copra and everything else are N/A (never "QC missing"/"Oil
// missing"). Applicability is read from the Product Master category, not from
// hard-coded material names.

const OIL_APPLICABLE_CATEGORY = /RICE\s*BRAN/i;
export const OIL_TOLERANCE_POINTS = 0.5; // percentage points

export function isQcOilApplicable(masterCategory: string | null): boolean {
  return !!masterCategory && OIL_APPLICABLE_CATEGORY.test(masterCategory);
}

export type QcOilResult = {
  applicable: boolean;
  qcOil: number | null; jmdOil: number | null; oilDifference: number | null;
  status: 'N/A' | 'PENDING_CN_DN' | 'PENDING_QC' | 'MATCHED' | 'MISMATCH';
};

export function computeQcOil(masterCategory: string | null, qcOilValues: number[], jmdOil: number | null): QcOilResult {
  if (!isQcOilApplicable(masterCategory)) return { applicable: false, qcOil: null, jmdOil: null, oilDifference: null, status: 'N/A' };
  const qcOil = qcOilValues.length ? qcOilValues.reduce((s, v) => s + v, 0) / qcOilValues.length : null;
  if (qcOil === null) return { applicable: true, qcOil: null, jmdOil, oilDifference: null, status: 'PENDING_QC' };
  if (jmdOil === null) return { applicable: true, qcOil, jmdOil: null, oilDifference: null, status: 'PENDING_CN_DN' };
  const oilDifference = Number((jmdOil - qcOil).toFixed(4));
  return { applicable: true, qcOil: Number(qcOil.toFixed(4)), jmdOil, oilDifference, status: Math.abs(oilDifference) <= OIL_TOLERANCE_POINTS ? 'MATCHED' : 'MISMATCH' };
}
