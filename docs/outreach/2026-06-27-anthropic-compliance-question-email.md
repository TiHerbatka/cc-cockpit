# Anthropic compliance-question outreach email (draft for review)

**Channel:** Submit a private request at support.claude.com ("Submit a request"); prefer a developer-relations contact if one is available.

**Subject:** Does a paid GUI tool that drives a user's own Claude Code via the headless CLI/SDK break any compliance terms?

---

Hello,

I'm an independent developer, and I'd like to confirm whether a tool I'm building is allowed under your legal and compliance guidance. I'm not asking for legal advice — only whether the setup below is permitted under your published terms.

The tool is a GUI frontend built mainly around Claude: it helps a user work with Claude Code across several projects and sessions at once, with quality-of-life features that make those interactions faster and easier than a plain terminal. It drives Claude Code through Claude's own headless interfaces — the CLI and/or the Agent SDK.

How it works, precisely:

- It runs on the user's own machine and drives the user's own, unmodified, official Claude Code installation under that user's own subscription login.
- Every user still needs to pay for his own Claude subscription, and has to install the official Claude application himself, on his own device. My tool never provides, brokers, or replaces that.
- It never reads, stores, proxies, extracts, or transmits OAuth tokens or any credentials; it never presents a Claude login; and it never sends requests on anyone else's behalf.
- One user, one machine, their own single subscription — nothing is shared, pooled, or resold.

The specific thing I want to confirm: my tool itself is a paid, commercial product — users pay a small subscription (roughly $1–5/month) to use the software. That subscription is scoped purely to my software and its own features; it does not meter, gate, resell, or affect Claude usage in any way. How much of my software someone buys has no bearing on their Claude usage, which they pay for and run entirely themselves.

Your "Authentication and credential use" guidance (code.claude.com/docs/en/legal-and-compliance) says subscription OAuth "is designed to support ordinary use of Claude Code," and names two third-party-developer restrictions — offering a Claude.ai login, and routing requests through Free/Pro/Max credentials on behalf of users. My tool does neither.

My one question:

**Does a paid, commercial GUI tool that drives a user's own official Claude Code installation through Claude's headless CLI/SDK — with no credential handling and no requests on anyone's behalf — break any of your legal or compliance terms?**

If there's a more specific doc or term I should read instead, a pointer is just as helpful. Thanks very much for your time.

Best regards,
[Your name]
[optional contact / project link]

---

## Notes before sending

- Don't put "cc-cockpit" in the email — "cc" reads as "Claude Code" (trademark surface). The product name is left out; add a neutral one only if wanted.
- This version intentionally asks the commercial question directly (overrides the earlier "keep money out" tactic). It is framed to make "yes" the easy answer, but a paid + headless ask is the higher-backfire framing, so a written "no" is the real downside if it comes. The $1–5 price point and "scoped purely to my software / doesn't touch Claude usage" lines are there to defuse the "you're reselling/metering access" worry.
- Treat any "yes" as comfort, not a license — save the thread, but keep a separate written rationale (the doc quote + two-prohibitions analysis) as the durable record.
