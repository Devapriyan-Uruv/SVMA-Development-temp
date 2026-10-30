import {redirect} from 'next/navigation';
// Once-per-shift safety checks now live inside the unified Solvent +
// Boiler plant entry page (as full 8-hour rows with NA support, same as
// everything else there) — kept as a redirect, not deleted, so any
// bookmarked link on a shift-floor tablet still lands somewhere correct.
export default function Inspection(){redirect('/input/hourly')}
