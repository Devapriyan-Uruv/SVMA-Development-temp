import { isGroupParty } from '@/lib/oneReconciliation/classification';

/** Tally spells the group companies with dots and spaces ("S.V.M.A.SOYA FOODS P LTD", "Maxibio Oleos"): compare on letters only as well. */
export const isGroupName = (name: string) => isGroupParty(name) || /svmasoya|soyafoods|maxibio/.test(String(name || '').toLowerCase().replace(/[^a-z]/g, ''));
