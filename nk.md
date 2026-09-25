Act as a senior product engineer, full stack engineer, frontend engineer, backend engineer, billing engineer, UI/UX designer, security engineer, cryptography engineer, database engineer, DevOps engineer, and QA engineer.

Work directly inside the existing **Baton** repository.

Your mission is to inspect the existing Baton codebase, understand its architecture, identify the actual implementation points, implement all requirements below, test everything thoroughly, fix every bug and security issue discovered, review the complete diff, and push the verified implementation to the existing GitHub repository.

Do not merely tell me what needs to be changed.

Actually inspect the codebase and implement the changes.

The final result must feel like a polished, production grade SaaS product intentionally designed and engineered by a professional human product team, not an AI generated template.

---

# 1. CRITICAL EXECUTION RULES

Before changing anything:

1. Inspect the entire repository.
2. Understand the existing architecture.
3. Identify the current source of truth for:
   • pricing
   • subscriptions
   • entitlements
   • payments
   • Stripe
   • USDC
   • organizations
   • teams
   • invitations
   • messaging
   • authentication
   • authorization
   • database models
   • UI components
4. Reuse existing architecture wherever possible.
5. Do not create duplicate systems.
6. Do not create fake functionality.
7. Do not blindly redesign working interfaces.
8. Preserve professional existing designs.
9. Make security decisions server side.
10. Never trust client supplied pricing, plan, entitlement, subscription status, sender identity, organization ID, team ID, or authorization claims.
11. Do not expose secrets.
12. Do not commit `.env` files, API keys, private keys, database credentials, Stripe secrets, encryption keys, or other sensitive information.
13. Test every feature you add or modify.
14. Fix every bug discovered during implementation.
15. Perform a complete security audit of the affected systems and the wider codebase.
16. Do not claim completion unless the implementation has actually been tested.
17. Review `git diff` before committing.
18. Commit and push only verified changes.

---

# 2. FINAL BATON PRICING

The authoritative pricing must be:

## TEAM

Monthly:

**$15/month**

Annual:

**$150/year**

Annual savings compared with twelve monthly payments:

**Save $30/year**

## ORGANIZATION

Monthly:

**$49/month**

Annual:

**$490/year**

Annual savings compared with twelve monthly payments:

**Save $98/year**

These values must become the actual source of truth throughout the application.

Do not merely update visible text.

Trace and update:

• pricing configuration
• subscription logic
• checkout
• Stripe
• USDC
• payment verification
• subscription activation
• entitlements
• dashboard
• billing pages
• admin dashboard
• plan comparison
• gifted plans
• manual plan management
• tests
• seed data
• API routes
• server actions
• emails/invoices where applicable

The annual savings calculations must be mathematically correct.

---

# 3. INSPECT THE BILLING ARCHITECTURE FIRST

Search the repository for:

```text
Team
Organization
$15
$49
$50
1500
4900
15000
49000
pricing
price
priceId
stripe
subscription
billing
checkout
USDC
entitlement
plan
billingPeriod
monthly
annual
```

Identify the actual source of truth.

Do not introduce a second pricing system.

If the application already has centralized plan configuration, extend it.

If the application has duplicated pricing logic, consolidate it safely where appropriate.

Do not blindly replace unrelated numbers.

---

# 4. BILLING PRICE REPRESENTATION

Ensure the prices are represented correctly according to the existing payment provider architecture.

If Stripe uses cents:

```text
Team monthly = 1500
Team annual = 15000

Organization monthly = 4900
Organization annual = 49000
```

If USDC uses another representation, follow the existing architecture and ensure decimal precision is handled correctly.

Never confuse dollars, cents, USDC units, token decimals, or database monetary representations.

Create a single authoritative pricing definition where the architecture allows it.

The frontend must consume authoritative pricing rather than independently hardcoding payment amounts.

---

# 5. STRIPE

Inspect the existing Stripe integration.

Correctly support:

```text
Team Monthly → $15
Team Annual → $150

Organization Monthly → $49
Organization Annual → $490
```

If Stripe Price IDs are used, identify the required:

• Team Monthly Price ID
• Team Annual Price ID
• Organization Monthly Price ID
• Organization Annual Price ID

Use environment variables for provider credentials and price IDs where appropriate.

Never expose Stripe secret keys in frontend code.

Never hardcode secrets.

If a Stripe dashboard action is required that cannot safely be performed from the repository, implement everything possible in code and clearly identify the external configuration still required.

Do not pretend an external Stripe configuration was completed if it was not.

Verify that checkout cannot be manipulated by modifying frontend values.

The server must determine:

• authenticated user
• plan
• billing period
• expected Stripe price
• expected amount
• payment status
• subscription status
• entitlement

---

# 6. USDC PAYMENT SYSTEM

Audit the existing USDC payment system.

Support:

```text
Team Monthly → $15
Team Annual → $150

Organization Monthly → $49
Organization Annual → $490
```

Verify:

1. Correct price is displayed.
2. Correct price is sent to the payment process.
3. Transaction hash is associated with the correct plan.
4. Server verifies the expected amount.
5. Server verifies the expected recipient.
6. Server verifies the expected token.
7. Server verifies the appropriate chain/network.
8. Server verifies transaction success/finality according to the existing architecture.
9. Server prevents replay of a transaction.
10. Server prevents the same transaction from activating multiple subscriptions.
11. Server derives expected pricing from authoritative configuration.
12. Client cannot submit a lower amount and receive the higher entitlement.
13. Client cannot change Team to Organization.
14. Failed verification does not activate a subscription.
15. Successful verification activates only the purchased plan.

Never trust a price supplied by the browser.

---

# 7. SUBSCRIPTION AND ENTITLEMENT SECURITY

Audit the entire subscription lifecycle:

```text
Plan selection
↓
Checkout
↓
Payment
↓
Payment verification
↓
Subscription creation/update
↓
Entitlement activation
↓
Dashboard refresh
↓
Feature access
```

Team subscriptions must produce Team entitlements.

Organization subscriptions must produce Organization entitlements.

The frontend must never be the authority for entitlement access.

Use server side authorization.

Verify:

• expired subscriptions
• cancelled subscriptions
• pending payments
• failed payments
• gifted plans
• manually granted plans
• manually revoked plans
• subscription upgrades
• subscription changes
• subscription ownership
• billing period changes

Follow the existing billing architecture's intended grace period behavior where applicable.

Do not create duplicate entitlement systems.

---

# 8. PRICING UI

Update the pricing interface.

Team:

```text
$15/month
$150/year
Save $30/year
```

Organization:

```text
$49/month
$490/year
Save $98/year
```

The monthly/annual toggle must actually control the underlying checkout selection.

When switching:

• displayed price changes
• billing period changes
• savings information changes
• CTA changes
• checkout selection changes
• payment metadata changes
• URL state remains correct if used
• refresh preserves correct state where intended
• no stale price remains in React/client state

Do not allow a user to visually select one price while the backend processes another.

---

# 9. COMPARE PLANS IN DETAIL

Audit the entire plan comparison.

Every advertised Team and Organization feature must correspond to a real implementation.

If a feature is advertised:

1. Determine whether it is actually intended.
2. If intended but incomplete, implement it properly.
3. If not intended, remove it from the comparison.

Do not leave placeholder features.

Do not advertise functionality that does not work.

---

# 10. TEAM PLAN AUDIT

Audit:

• Team creation
• Team members
• Invitations
• Member management
• Permissions
• Repository/team access
• Messaging
• Subscription state
• Entitlements
• Plan enforcement

Team users must receive the Team features Baton actually defines.

---

# 11. ORGANIZATION PLAN AUDIT

Audit:

• Organization creation
• Organization members
• Invitations
• Roles
• Team management
• Repository access
• Team messaging
• Organization messaging
• Organization settings
• Member permissions
• Subscription ownership
• Organization plan access
• Organization entitlements

Do not invent unrelated features.

Only implement functionality supported by Baton's existing product architecture and requirements.

---

# 12. REVOKE PENDING INVITATION UI

Currently, revoking a pending team/organization invitation uses a basic browser JavaScript popup.

Replace it completely.

Do NOT use:

```javascript
alert()
confirm()
prompt()
window.alert()
window.confirm()
window.prompt()
```

for this production interaction.

First determine whether Baton already has a reusable Dialog/Modal component.

If it exists, reuse it.

If not, create a professional reusable dialog system using the existing design system.

The revoke dialog should contain:

### Header

**Revoke invitation?**

### Recipient context

Display where available:

• avatar
• display name
• username
• email

Example:

```text
Revoke invitation?

You're about to revoke the pending invitation sent to
@username.

They will no longer be able to use this invitation to
join the organization.
```

Actions:

**Cancel**

**Revoke invitation**

The destructive action should be clearly distinguishable without making the interface visually aggressive.

The dialog must:

• work on desktop
• work on mobile
• manage focus correctly
• support keyboard navigation
• have correct dialog semantics
• prevent duplicate submissions
• display loading state
• handle success
• handle failure
• close correctly
• update the invitation list without unnecessary page reload
• preserve authorization
• preserve the existing revoke functionality

Loading:

```text
Revoking...
```

Success:

```text
Invitation revoked successfully.
```

Failure:

```text
We couldn't revoke this invitation. Please try again.
```

---

# 13. AUDIT ALL JAVASCRIPT POPUPS

Search the entire codebase for:

```text
alert(
confirm(
prompt(
window.alert
window.confirm
window.prompt
```

Also search for custom implementations that behave like primitive browser dialogs.

Identify every user facing instance.

For each one:

1. Determine its purpose.
2. Determine whether it is production user facing.
3. Replace inappropriate browser dialogs with proper Baton UI.
4. Preserve developer/debugging behavior where appropriate.

Use:

• dialogs
• confirmation modals
• destructive action modals
• form dialogs
• toasts
• inline feedback
• contextual error messages

Do not blindly replace every occurrence.

---

# 14. REUSABLE DIALOG SYSTEM

Create or reuse a consistent dialog system supporting:

• title
• description
• icon
• primary action
• secondary action
• destructive actions
• loading
• errors
• success
• keyboard accessibility
• focus trapping
• focus restoration
• mobile responsiveness
• animation
• escape handling
• backdrop interaction where appropriate

Do not create several visually inconsistent modal implementations.

---

# 15. TEAM MEMBER MESSAGING

There must be an obvious way for team members to message other members of the same team.

First inspect whether messaging already exists.

Audit:

• messaging routes
• conversation models
• message models
• server actions
• API routes
• database schema
• organization membership
• team membership
• permissions
• navigation
• message UI
• notifications

Determine whether messaging is:

1. Existing but hidden.
2. Existing but broken.
3. Partially implemented.
4. Completely missing.

Do not duplicate an existing messaging architecture.

---

# 16. TEAM MESSAGING UX

Within a Team's member interface, users should be able to easily find another member and message them.

Example concept:

```text
Abraham Uloko
@abraham
Security Researcher

[Message]
```

Do not blindly copy this design.

Use Baton's existing design system.

The Message action should appear in the most natural existing location, such as:

• member card
• member table action menu
• member profile
• member details

Do not add redundant Message buttons everywhere.

---

# 17. ORGANIZATION MESSAGING

The same principle must apply at the Organization level.

Organization members should be able to easily message other authorized organization members.

Audit the organization member UI and provide a natural Message action.

A user should be able to:

```text
Organization
↓
Members
↓
Select member
↓
Message
↓
Conversation
↓
Send message
```

Do not create separate duplicate messaging systems for Teams and Organizations.

Use one secure underlying messaging architecture with authorization based on membership and context.

---

# 18. END TO END ENCRYPTED MESSAGING — CRITICAL

Messaging must use a genuine secure **end to end encryption architecture**.

This is a critical requirement.

Do NOT implement fake E2E encryption by merely:

• encrypting in the database with a server controlled key
• base64 encoding messages
• hashing messages
• encrypting on the server before storage
• storing plaintext alongside ciphertext
• calling ordinary HTTPS transport encryption "E2E"

The intended model is:

```text
Sender client
↓
Encrypt locally
↓
Encrypted ciphertext
↓
Server transports/stores ciphertext
↓
Recipient client
↓
Decrypt locally
↓
Plaintext
```

The server/database should not need access to message plaintext.

---

# 19. E2E CRYPTOGRAPHIC DESIGN

Before implementation, inspect the existing stack and select an appropriate audited cryptographic primitive/library.

Prefer established browser/server cryptography APIs or well maintained cryptographic libraries rather than implementing cryptographic primitives manually.

Do NOT invent cryptography.

Do NOT write custom encryption algorithms.

Do NOT use insecure primitives such as:

• ECB mode
• static IVs/nonces
• predictable keys
• hardcoded keys
• passwords directly as encryption keys
• reversible obfuscation
• base64
• plain hashing as encryption

Use authenticated encryption such as an appropriate AEAD construction supported by the selected architecture.

Keys must be generated and managed safely.

The architecture should provide:

• sender identity authentication
• recipient key discovery
• public/private key separation
• message encryption
• message authentication/integrity
• ciphertext storage
• safe key handling
• key rotation strategy where appropriate
• device/session considerations
• recovery considerations
• forward secrecy considerations where feasible
• replay protection where applicable

Do not claim "E2E encrypted" unless the actual architecture provides it.

---

# 20. E2E KEY SECURITY

Private encryption keys must never be exposed to unauthorized users.

Never:

• send private keys through normal API responses
• store private keys in plaintext on the server
• expose private keys in database records accessible to admins
• log private keys
• log plaintext messages
• include plaintext message bodies in analytics
• send private keys to another user
• trust a client supplied sender private key

Inspect browser storage decisions carefully.

Where client-side persistent key storage is required, use appropriate browser security mechanisms and minimize exposure.

Document the trust model.

---

# 21. E2E MESSAGE FLOW

Implement and test:

### User A

1. Authenticates.
2. Generates/loads their messaging key material.
3. Selects User B.
4. Obtains User B's appropriate public key.
5. Encrypts message locally.
6. Sends ciphertext.
7. Server validates authorization.
8. Server stores/transports ciphertext.
9. User B receives ciphertext.
10. User B decrypts locally.
11. User B sees plaintext.

At no point should the server need the plaintext to deliver the message.

---

# 22. E2E GROUP/TEAM/ORGANIZATION MESSAGING

If team or organization conversations involve multiple recipients, design the encryption architecture appropriately.

Do not simply encrypt a group message with a shared plaintext server key.

Use a secure group messaging/key distribution approach appropriate for the actual Baton architecture.

At minimum:

• unauthorized users must not decrypt messages
• removed members must not automatically retain future access
• new members must not automatically gain access to old private messages unless explicitly intended
• organization/team membership must control conversation authorization
• server must not be able to impersonate a legitimate sender

If the existing product only supports secure 1:1 messaging and group E2E requires substantial new architecture, implement the safest architecture supported by the current product requirements rather than falsely claiming full group E2E.

---

# 23. MESSAGE AUTHORIZATION

Messaging authorization must be enforced server side.

Verify:

• authenticated sender
• valid recipient
• shared organization membership
• shared team membership where required
• organization access
• team access
• conversation membership
• sender identity
• recipient identity

Prevent:

• IDOR
• user impersonation
• arbitrary conversation access
• arbitrary message modification
• unauthorized message deletion
• cross organization messaging
• cross team data access
• forged sender IDs
• forged organization IDs
• forged team IDs

The server must derive identity from the authenticated session.

Never trust:

```text
senderId
userId
organizationId
teamId
conversationId
role
```

from the client without authorization checks.

---

# 24. MESSAGE INTEGRITY

Messages must be protected against tampering.

Verify that an attacker cannot modify ciphertext or associated metadata without detection.

Use authenticated encryption.

Handle:

• invalid ciphertext
• malformed ciphertext
• wrong key
• replayed ciphertext
• corrupted messages

gracefully.

Never expose cryptographic secrets in error responses.

---

# 25. MESSAGE PRIVACY

Audit all places where message content could accidentally leak:

• server logs
• database logs
• analytics
• error monitoring
• notifications
• admin dashboard
• debugging logs
• API responses
• browser console
• URLs
• query strings
• metadata
• search indexing

Do not log plaintext messages.

Do not include sensitive message content in error messages.

---

# 26. TEAM/ORGANIZATION MEMBER DISCOVERY

Make it easy to find authorized members.

Consider the existing UX for:

• search
• filters
• member lists
• profiles
• action menus

The user should not need to navigate through several confusing screens to message another team or organization member.

Keep the interaction simple and intentional.

---

# 27. FOOTER

Remove:

**Status: Operational**

from the footer.

Also remove the status element immediately preceding it if it is part of the same status section.

Do not replace it with another fake operational indicator.

Rebalance spacing after removal.

---

# 28. FULL UI/UX AUDIT

Audit:

• landing page
• authentication
• dashboard
• admin dashboard
• organization pages
• team pages
• members
• messaging
• billing
• pricing
• settings
• account
• navigation
• sidebar
• header
• footer
• dialogs
• dropdowns
• tables
• forms
• empty states
• loading states
• error states
• buttons
• cards
• badges
• tooltips
• mobile layouts

Do not redesign everything blindly.

Preserve already polished areas.

Improve areas that:

• look generic
• look AI generated
• have inconsistent spacing
• use excessive cards
• use unnecessary gradients
• have weak hierarchy
• use awkward icons
• use excessive rounded containers
• have inconsistent buttons
• have poor mobile behavior
• have primitive dialogs
• have poor empty states
• have inconsistent tables
• feel unfinished

---

# 29. HUMAN DESIGNED VISUAL LANGUAGE

Avoid:

• excessive glassmorphism
• excessive gradients
• glowing effects
• meaningless decorative elements
• huge empty sections
• excessive rounded cards
• repetitive dashboard cards
• random icons
• excessive badges
• generic AI startup aesthetics
• unnecessary animation
• decorative backgrounds without purpose

Prioritize:

• strong typography
• clear hierarchy
• intentional spacing
• restrained color
• useful grouping
• excellent information density
• professional tables
• clear actions
• subtle transitions
• strong responsive behavior
• meaningful interaction states

Baton should look like a serious developer/productivity SaaS.

---

# 30. DESIGN CONSISTENCY

Audit:

• buttons
• typography
• border radius
• colors
• borders
• shadows
• spacing
• icons
• dropdowns
• dialogs
• badges
• tables
• forms
• hover states
• focus states
• loading states
• disabled states

Where possible, consolidate inconsistencies into reusable components or design tokens.

Do not create one-off fixes everywhere.

---

# 31. RESPONSIVE DESIGN

Test:

• desktop
• laptop
• tablet
• mobile

Pay special attention to:

• pricing
• checkout
• revoke dialog
• member lists
• messaging
• team pages
• organization pages
• admin dashboard
• tables
• navigation
• dialogs

There must be:

• no horizontal overflow
• no clipped buttons
• no overlapping dialogs
• no unusable tables
• no broken navigation
• no inaccessible actions

---

# 32. ACCESSIBILITY

Verify:

• keyboard navigation
• dialog semantics
• focus management
• focus restoration
• accessible labels
• accessible buttons
• sufficient contrast
• visible focus states
• screen reader support
• loading announcements where appropriate
• error announcements where appropriate
• destructive actions are not communicated by color alone

---

# 33. FULL SECURITY AUDIT

Perform a broad security audit of the entire Baton codebase, not only the new functionality.

Inspect:

• authentication
• authorization
• session handling
• cookies
• CSRF protections where applicable
• XSS
• injection
• SQL/Prisma query safety
• IDOR
• privilege escalation
• organization isolation
• team isolation
• API authorization
• server actions
• route handlers
• webhook verification
• Stripe webhook security
• USDC payment verification
• replay attacks
• transaction verification
• subscription manipulation
• entitlement manipulation
• admin authorization
• invite authorization
• invite revocation
• member management
• messaging authorization
• E2E key handling
• secret exposure
• environment variables
• logging
• error handling
• rate limiting
• brute force risks
• file uploads where applicable
• URL validation
• redirect validation
• open redirects
• SSRF risks where applicable
• unsafe deserialization
• prototype pollution where applicable
• dependency vulnerabilities
• sensitive information exposure
• race conditions
• concurrency issues
• database transaction boundaries

Search for patterns such as:

```text
any
as any
@ts-ignore
@ts-nocheck
dangerouslySetInnerHTML
eval(
new Function(
innerHTML
document.cookie
localStorage
sessionStorage
process.env
secret
token
password
privateKey
senderId
userId
organizationId
teamId
subscriptionId
price
amount
role
admin
```

Do not blindly change every match.

Inspect the context and fix genuine security issues.

---

# 34. AUTHORIZATION MODEL

For every sensitive operation, verify authorization server side.

Sensitive operations include:

• subscription changes
• plan grants
• plan revocation
• gifting plans
• changing plans
• organization settings
• team settings
• member management
• invitation creation
• invitation revocation
• messaging
• conversation access
• message modification
• repository access
• admin operations

A normal user must not be able to grant themselves a paid plan.

A Team user must not be able to escalate to Organization.

A user in Organization A must not access Organization B.

A team member must not access a private team they do not belong to.

A removed member must lose access according to the intended product authorization model.

---

# 35. DATABASE SECURITY

Inspect the Prisma schema and database access layer.

Do not create duplicate tables unnecessarily.

Check:

• unique constraints
• foreign keys
• cascading behavior
• orphaned records
• authorization boundaries
• transaction handling
• race conditions
• nullable security sensitive fields
• subscription uniqueness
• payment uniqueness
• transaction hash uniqueness
• conversation membership
• message ownership

If schema changes are genuinely required, use the existing migration architecture.

Do not replace working database infrastructure unnecessarily.

---

# 36. PAYMENT SECURITY

Verify that users cannot manipulate:

• price
• plan
• billing period
• currency
• payment status
• subscription status
• entitlement
• provider metadata

The backend must derive authoritative payment expectations.

Verify Stripe webhooks cryptographically using the official mechanism already supported by the architecture.

Do not trust webhook payloads without signature verification.

Prevent duplicate processing.

Use idempotency where appropriate.

---

# 37. ADMIN SECURITY

Audit all admin endpoints.

Verify:

• admin authorization happens server side
• ordinary users cannot call admin APIs
• client UI hiding is not the security mechanism
• admin actions validate target IDs
• admin actions cannot cross unauthorized boundaries
• sensitive admin actions cannot be forged
• admin audit information does not leak secrets

---

# 38. INVITATION SECURITY

Audit invitation creation and revocation.

Verify:

• only authorized users can invite members
• only authorized users can revoke invitations
• invitations cannot be forged
• invitation tokens are sufficiently protected
• revoked invitations cannot be reused
• expired invitations behave correctly if expiration exists
• invitation state changes are atomic
• users cannot manipulate organization/team IDs
• duplicate invitation behavior is intentional

---

# 39. SECURITY BUG FIXING REQUIREMENT

Do not merely report security bugs.

For every genuine vulnerability discovered:

1. Determine the root cause.
2. Determine affected code paths.
3. Fix it.
4. UpdatRe-test the attack path.
6. Verify no regression was introduced.

Do not hide or suppress security warnings simply to make the build pass.

---

# 40. TEST REVOKE INVITATION

Actually test:

1. Login as authorized admin/team manager.
2. Open organization/team management.
3. Find pending invitation.
4. Click Revoke.
5. Verify professional dialog appears.
6. Verify correct recipient.
7. Click Cancel.
8. Verify invitation remains.
9. Open again.
10. Confirm revocation.
11. Verify loading state.
12. Verify successful revocation.
13. Verify invitation list updates.
14. Attempt using the revoked invitation.
15. Verify it cannot be used.
16. Attempt unauthorized revocation.
17. Verify server rejects it.

---

# 41. TEST TEAM MESSAGING

Actually test:

1. Login as Team member A.
2. Open Team.
3. Open Team members.
4. Find Team member B.
5. Click Message.
6. Verify correct recipient.
7. Open conversation.
8. Send message.
9. Verify encryption occurs client side.
10. Verify server receives/stores ciphertext rather than plaintext.
11. Verify recipient decrypts successfully.
12. Login as recipient.
13. Verify conversation exists.
14. Reply.
15. Verify sender receives reply.
16. Verify conversation remains correctly authorized.
17. Attempt unauthorized access.
18. Verify access is rejected.
19. Attempt forged sender ID.
20. Verify server ignores/rejects it.
21. Attempt forged team ID.
22. Verify server rejects it.

---

# 42. TEST ORGANIZATION MESSAGING

Test the same complete flow at Organization level.

Verify:

• authozed organization members can message each other
• unauthorized users cannot access conversations
• users cannot cross organization boundaries
• removed members lose access according to the intended model
• new members do not gain unintended historical message access
• E2E encryption remains intact
• sender identity cannot be forged

---

# 43. TEST E2E ENCRYPTION

Verify technically rather than visually.

Confirm:

• plaintext is not sent to message APIs
• plaintext is not stored in database
• plaintext is not logged
• encryption happens before network transmission
• ciphertext cannot be decrypted without the appropriate key
• recipient can decrypt
• modified ciphertext fails authentication
• unauthorized user cannot decrypt
• server does not possess the client private key
• keys are not accidentally exposed in API responses
• browser console contains no sensitive plaintext logging

Use automated tests wherever possible.

---

# 44. TEST PRICING

Test:

### Team Monthly

```tt
$15
```

### Team Annual

```text
$150
```

### Organization Monthly

```text
$49
```

### Organization Annual

```text
$490
```

Verify:

• correct checkout
• correct provider amount
• correct metadata
• correct billing period
• correct subscription
• correct entitlement
• correct dashboard state
• correct admin state

---

# 45. TEST SECURITY ATTACK PATHS

Attempt:

• client-side price manipulation
• Team → Organization escalation
• Organization A → Organization B access
• unubscription changes
• unauthorized plan gifting
• forged payment metadata
• replayed payment transaction
• duplicate payment activation
• forged sender ID
• forged team ID
• forged organization ID
• unauthorized conversation access
• unauthorized message modification
• revoked invitation reuse
• unauthorized invitation revocation
• direct API access without UI permissions
• modified request bodies
• modified query parameters
• modified path parameters

Every invalid operation md server side.

---

# 46. TEST ADMIN DASHBOARD

Verify administrators see:

• user
• email
• plan
• billing period
• subscription status
• amount
• start date
• renewal/end date
• subscription ID where applicable
• payment provider

Do not show only technical IDs when human-readable information is available.

Verify Team and Organization use the new pricing throughout the admin system.

---

# 47. GIFTED PLANS

Audit:

• gifted Team plans
• gifted Organization plans
• duration
•
• dashboard
• expiration
• revocation
• admin visibility

Gifted subscriptions must use the same authoritative entitlement architecture.

Do not create a second entitlement path.

---

# 48. DASHBOARD REFRESH AFTER PAYMENT

After successful payment:

```text
Payment
↓
Verification
↓
Subscription activation
↓
Entitlement activation
↓
Dashboard update
```

The user should not need to log out and log back in.

Implement correct cache invalidation/revalidation or authenticated state refresh.

---

# 49. SEARCH FOR OLD PRICING

Search the entire repository for:

```text
$50
old Team price
old Organization price
old annual price
hardcoded Stripe amounts
hardcoded USDC amounts
old comparison values
checkout amounts
confirmation amounts
invoice amounts
email pricing
admin pricing
subscription API pricing
server action pricing
test pricing
seed pricing
```

Update genuine outdated references.

Do not blindly replace unrelated numbers.

---

# 50. TESTING SUITE

Run all applicable:

• lint
• TypeSc/type checking
• unit tests
• integration tests
• API tests
• security tests
• E2E tests
• production build

Fix every error caused by your implementation.

If an unrelated pre-existing test fails:

1. Identify it.
2. Determine whether your changes affect it.
3. Do not pretend the test suite passed.
4. Report it accurately.

---

# 51. FINAL CODE REVIEW

Before committing:

1. Review complete `git diff`.
2. Inspect every changed file.
3. Remove debugging code.
4. Remove temporary logs.
5. Removerts.
6. Remove dead code.
7. Remove duplicate pricing logic.
8. Remove duplicate messaging logic.
9. Verify E2E encryption is genuine.
10. Verify no plaintext message logging.
11. Verify no secrets.
12. Verify `.env` remains ignored.
13. Verify no client-only authorization.
14. Verify no frontend-only entitlement enforcement.
15. Verify no insecure cryptography.
16. Verify no old pricing remains accidentally.
17. Verify no browser-native production popups remain where they should be replaced.
18. Verify responsive behavior.
19. Verify accessibility.
20. Verify security tests.
21. Verify all modified features.

---

# 52. GIT

After everything is verified:

Run:

```bash
git status
git diff
```

Ensure only relevant files changed.

Ensure no secrets are present.

Commit with a clear message such as:

```text
feat: harden billing, messaging, security and product UX
```

Then push to the existing Baton GitHub repository.

Do not push:

• `.env`
• API keys
• Stripe secrets
• database credentials
• privaencryption private keys
• wallet private keys
• sensitive tokens

Do not claim the push succeeded unless it actually succeeded.

---

# 53. DEFINITION OF DONE

The implementation is complete only when all of the following are true:

## Billing

• Team = $15/month
• Team = $150/year
• Organization = $49/month
• Organization = $490/year
• Annual savings are correct
• Monthly/annual toggle works
• Stripe pricing is correct
• USDC pricing is correct
• Server authoritative pricing is enforcayment verification is secure
• Duplicate payment activation is prevented
• Correct subscriptions are created
• Correct entitlements are granted
• Dashboard updates without logout
• Admin sees correct subscription information
• Gifted plans use the same entitlement architecture
• Old pricing references are removed where appropriate

## Invitations

• Revoke no longer uses browser JavaScript popups
• Professional confirmation dialog exists
• Loading/success/error states work
• Unauthorivoke attempts fail
• Revoked invitations cannot be reused

## Messaging

• Team members can easily message other Team members
• Organization members can easily message other Organization members
• Existing messaging architecture is reused where possible
• Messaging authorization is server enforced
• Sender identity cannot be forged
• Conversation access is protected
• Cross organization access is blocked
• Cross team unauthorized access is blocked
• Messages are genuinely E2E encrypted
âr stores/transports ciphertext rather than plaintext
• Private keys are not exposed
• Message tampering is detected
• Unauthorized users cannot decrypt messages
• Messaging flows are fully tested

## Security

• Entire codebase has been audited
• Genuine security bugs discovered are fixed
• IDOR vulnerabilities are addressed
• privilege escalation is addressed
• payment manipulation is addressed
• entitlement manipulation is addressed
• admin authorization is verified
• invitation ation is verified
• messaging authorization is verified
• organization isolation is verified
• team isolation is verified
• webhook security is verified
• replay protection is verified where applicable
• secrets are protected
• sensitive data is not logged
• cryptography is implemented using established primitives
• no fake E2E implementation exists

## UI/UX

• Baton looks professional
• Existing good designs are preserved
• Pricing is clear
• Team vs Organization differences are alogs are polished
• No unnecessary browser popups remain
• Messaging is easy to discover
• Footer status indicator is removed
• Mobile is responsive
• Desktop is responsive
• Tablet is responsive
• Accessibility is verified
• No unnecessary gradients/glassmorphism/template aesthetics
• No broken layouts
• No horizontal overflow

## Testing

• Unit tests run
• Integration tests run
• E2E tests run
• Security tests run
• Pricing tests run
• Messaging tests run
• Invitation tts run
• Authorization tests run
• Production build passes
• Final UI manually inspected
• Final git diff reviewed

## Git

• Changes committed
• Commit hash recorded
• Changes pushed to GitHub
• No secrets committed

---

# 54. FINAL REPORT

After implementation, return a concise but complete report containing:

1. Billing architecture inspected.
2. Pricing implementation details.
3. Team pricing verification.
4. Organization pricing verification.
5. Stripe status.
6. USDC status.
7. Payment verification/security changes.
8. Subscription/entitlement changes.
9. Revoke invitation root cause and fix.
10. Number of browser-native/user-facing popups replaced.
11. Team messaging implementation status.
12. Organization messaging implementation status.
13. E2E encryption architecture used.
14. E2E encryption test results.
15. Authorization/security audit findings.
16. Security vulnerabilities fixed.
17. Invitation security results.
18. Payment security results.
19. Admin security results.
20. Footer status removal.
21. UI/UX improvements.
22. Responsive verification.
23. Accessibility verification.
24. Test results.
25. Build result.
26. Git commit hash.
27. Push status.
28. Any external configuration that still requires manual action.

Do not expose secrets, private keys, credentials, encryption keys, or sensitive environment variables.

Most importantly:

**Do not simply describe the work. Inspect the Baton repository, implement the complete solution, test every feature and attack path, fix all discovered bugs and security vulnerabilities, verify the final application, commit the changes, and push the verified implementation to GitHub.**

