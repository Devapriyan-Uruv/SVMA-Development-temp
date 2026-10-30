# V7 SQL execution order

For a database already upgraded through V6:

1. Open Supabase SQL Editor.
2. Run the complete contents of `sql/000_RUN_THIS_NOW_V7.sql`.
3. Restart/redeploy the Next.js application.
4. Confirm Solvent Input no longer shows Lab Analysing Report.
5. Test one normal and one out-of-target reading, then confirm the deviation ticket is created.
6. Complete a test shift and download the Excel report to verify Ticket ID, AI Comments and AI hypothesis columns.
