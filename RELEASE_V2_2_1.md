# SVMA Intelligent AI Operations v2.2.1

Build-stability patch for v2.2.

## Fixed
- Added the missing React `FormEvent` type import in Administration.
- Corrected the AI refresh button handler so a React mouse event is not passed into the boolean `silent` argument.
- Aligned `tsconfig.json` with Next.js 16 generated settings (`react-jsx` and dev type include) to avoid repeated automatic rewrites during build.
- Added `npm run verify` to run TypeScript checking before the production build.

No database migration changes from v2.2.0.
