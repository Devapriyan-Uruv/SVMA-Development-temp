export function greetingFor(hour: number) {
 if (hour >= 5 && hour < 12) return 'Good morning';
 if (hour >= 12 && hour < 17) return 'Good afternoon';
 return 'Good evening';
}

function nameFromLocalPart(local: string) {
 const words = local.replace(/[._-]+/g, ' ').split(' ').filter(Boolean);
 return words.length ? words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'there';
}

// A raw email is not a name — this covers two cases that both need it
// derived from the address's local part instead: full_name was never set
// (falls back to the email param), and full_name WAS set but only because
// the signup trigger defaults it to the account's email address when no
// display name is provided at creation (`coalesce(full_name, email)` in
// handle_new_user()) — so a non-empty full_name can still literally BE an
// email string, not a name.
export function friendlyName(fullName?: string | null, email?: string | null) {
 const name = (fullName || '').trim();
 if (name && !name.includes('@')) return name.split(/\s+/)[0];
 const source = name.includes('@') ? name : (email || '');
 const local = source.split('@')[0];
 return local ? nameFromLocalPart(local) : 'there';
}
