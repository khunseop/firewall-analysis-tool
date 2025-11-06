# TODO List

## UX/UI Refinement (Completed)
- [x] Enhance overall look and feel with a more sophisticated and polished design.
- [x] Maintain the existing minimalist aesthetic without adding flashy elements.
- [x] Apply a monochrome color scheme with blue as the primary accent color.
- [x] Implement the 'Pretendard' web font locally to improve typography and readability.
- [x] Refine UI component details (buttons, modals, inputs) for a consistent user experience.

## Policy Analysis Feature

### Backend (Completed)
- [x] Add database models for `AnalysisTask` and `RedundancyPolicySet`.
- [x] Create Alembic migration for the new models.
- [x] Implement CRUD functions for the new models.
- [x] Implement core redundancy analysis service logic.
  - [x] Ensure only one analysis task can run at a time using a lock.
  - [x] Adapt legacy analysis logic to use SQLAlchemy and pre-calculated index tables.
- [x] Add API endpoints to start, monitor, and retrieve analysis results.

### Frontend (Pending)
- [ ] Create a new "Policy Analysis" page.
- [ ] Add a button to trigger the redundancy analysis for a selected device.
- [ ] Implement UI to show the status of the running/last analysis task (e.g., pending, in_progress, success, failure).
- [ ] Create a component to display the redundancy analysis results in a table format.
  - The table should group policies by `set_number`.
  - Clearly distinguish between `UPPER` and `LOWER` rule types.
  - Display all relevant policy details for easy comparison.
