# Talk track: the progressive trust ladder

Presenter path, about 8 minutes. Everything on screen is MOCK: no bank, no PingOne tenant, no real money. Say that first, then point at the MOCK banner. The vertical words on the page come from the customer's vertical (`customer.config.json`); the default is the bank pack. The numbers below are the real limits of this lab.

## Before you start

- Open the page and press **Reset** so the rung is 0 (Public), the history is empty and the diagram boxes are back in place.
- The header shows **Mock | Live**. Mock is the only mode this lab has: Live answers that there is no live provider. Say so if asked, and stay on Mock.
- Presenter mode (the button at the top, or the **P** key; **Esc** leaves it) enlarges the text and hides the raw trace and proofs. The MOCK banner stays on screen. Use it on a projector.
- The limits: a payment of 300 or less needs rung 1 (signed in); up to 600 needs rung 2 (step-up); up to 1000 needs rung 3 (phone approval). Above 1000 is refused for everyone.

## The path

### 1. Rung 0: Public (about 1 minute)

- **Say:** "This is the agent acting for the customer. It starts with no trust at all, and it can only earn more by showing a proof for each step."
- **Click:** enter 300 and press **Send payment**.
- **Expect:** refused, "Not enough trust for this payment yet. Rung 0." The refusal is the point: the payment never reached the bank because no proof was given.

### 2. Rung 1: Signed in (about 1 minute)

- **Say:** "Signing in is the first proof. It is fresh for one hour. A second sign-in is refused on purpose: a rung rises one step at a time, each with its own proof."
- **Click:** **Sign in**, then send 300 again.
- **Expect:** the payment is done and the rung is 1. The raw trace (hide it in presenter mode) shows the traceparent of each call.

### 3. Rung 2: Step-up satisfied (about 2 minutes)

- **Say:** "A bigger payment asks for more. The step-up check is a fresh proof, valid for five minutes."
- **Click:** enter 500 and send. Expect a refusal that names the step-up.
- **Click:** **Step-up check**, then send 500 again.
- **Expect:** done, rung 2. Under the hood, the step-up proof is a mock claim minted by this lab, labelled as such in the proofs section.

### 4. Rung 3: CIBA approved (about 2 minutes)

- **Say:** "For the largest amounts, the phone decides. The agent asks; the customer's device approves or refuses. The agent cannot approve its own request."
- **Click:** enter 800, press **Ask phone to approve**. The mock phone lists "Pay $800".
- **Click:** **Approve on phone**. The page says the phone approved, and the rung moves to 3.
- **Click:** **Send payment**. Expect done, rung 3.
- **Say:** "The approval is single use. Send the same payment again and it needs a new approval."

### 5. Risk never lowers the rung (about 1 minute)

- **Say:** "Risk is separate from the amount. A high risk score raises the rung a payment needs, even for a small amount. A low score never lowers the rung you have earned."
- **Click:** drag the risk slider to 95. Enter 100 and send. Expect a refusal: the risk floor now asks for rung 3.
- **Say:** "Put the risk back down. The rung stays where it was, because the rung only moves on proofs and on step-downs."

### 6. Step down, with a reason (about 1 minute)

- **Say:** "Stepping down is allowed, and it is always recorded, with a reason the customer types."
- **Click:** choose a lower rung, type a reason, press **Step down**. Expect the history to show the fall with "explicit".

### 7. Reset (about 30 seconds)

- **Click:** **Reset**. The rung, the history, the proofs, the phone list and the diagram box positions all clear.

## What to say if asked

- **Is this a real bank?** "No. Vellum Savings and every vertical name are fictional. It is a mock, and the banner says so."
- **Are the tokens real?** "They are minted by this lab and labelled MOCK. The claim values and the windows are mock values, not a verified configuration of any product."
- **Is the phone a separate channel?** "No. In this lab the mock phone is on the same origin, so the requester can reach it. Do not describe it as a separate approval channel."
- **Why 422 for refusals?** "A refusal is the system working. The browser logs a 4xx as an error, so the console shows it as a deliberate refusal."
- **Can I switch to Live?** "No. This lab has no live provider, so Live is refused with that message. Mock runs fully offline."
- **Can I change the words?** "Yes. The customer's vertical in `customer.config.json` picks the story pack: the rung names, the needs and the headings change; the limits do not."
