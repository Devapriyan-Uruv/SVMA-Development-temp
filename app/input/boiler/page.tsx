import {redirect} from 'next/navigation';
// Boiler now lives inside the unified Solvent + Boiler plant entry page
// (its categories just appear as blocks there, on whichever page the
// row-budget chunking puts them on) — kept as a redirect, not deleted, so
// any bookmarked link on a shift-floor tablet still lands somewhere correct.
export default function Boiler(){redirect('/input/hourly')}
