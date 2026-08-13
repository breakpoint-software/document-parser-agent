RULE_CREATE_EDIT_CASE = """
Open http://localhost:4200 and act as a real user.

Test case: create and edit a rule in the default workspace, including all
mandatory-field validation.

1. Enter the default workspace. If authentication is required, use the
   available Google sign-in flow. Navigate to the workspace's Rules Manager.
2. Start creating a rule and submit the untouched form.
3. Verify that the rule is not created, that the message
   "Complete all required rule fields." is shown, and that visible required
   field errors are shown. Record every mandatory field that blocks creation,
   including the rule name, target folder, priority, and the condition field,
   operator, and value. Do not treat the target spreadsheet or sheet tab as
   mandatory unless the running UI actually blocks submission for them.
4. Check the editable mandatory fields individually where the UI permits it:
   leave or clear the field, submit, verify saving is blocked, record the
   validation feedback, and then restore a valid value. The initial empty-form
   submission covers mandatory read-only picker fields.
5. Complete the form with valid values. Use "UI Test Rule" as the rule name,
   keep a non-negative priority, configure one valid condition, and select a
   target folder using the picker. Select a spreadsheet and enter a sheet tab
   only if the running workflow requires them. Submit the form.
6. Verify the success feedback and confirm "UI Test Rule" appears in the rule
   list. If a rule with that exact name already exists, use it for the edit
   portion rather than creating a duplicate, and report that choice.
7. Open that rule for editing. Clear the rule name and try to save. Verify the
   update is blocked and the required validation feedback is shown.
8. Set the name to "UI Test Rule Edited", preserve valid mandatory values, save
   the changes, and verify the success feedback and updated name in the list.

Do not delete the rule. Do not claim a validation passed unless you observed
that saving was blocked and/or the expected feedback appeared.

At the end, report:

STATUS: PASS or FAIL

EXPECTED:
The expected create, validation, edit, and persistence behavior.

ACTUAL:
What actually happened, including the final saved rule name.

VALIDATION CHECKS:
Each mandatory field checked, the action used, and the observed feedback.

STEPS:
The actions performed.

ERROR:
Any problem encountered, or "None".
"""