# Keeping decisions in an agentic workflow

During my final project, I asked the agent to make the sky look richer. It
produced several effects that I accepted after looking at them separately.
When I used the complete scene, I found it too busy. Comparing it with an
earlier version using the same data helped me decide what to remove. Only
then could I write specific instructions about keeping the appearance calm.
This experience made me question how much judgement can be built into an
agent's working environment.

Böckeler (2026) describes a harness as including guides that direct an agent
and sensors that check its work. A project instruction file or a spec provides
guidance, while tests provide feedback. Klaassen's account of compound
engineering suggests that putting lessons back into this environment can
improve later work and reduce the effort required from people. I can see why
this is useful. My concern is the assumption that preserving more lessons will
gradually reduce the need for human judgement. In my project, the rules became
useful because I had already worked through a decision.

Willison's (n.d.) distinction between cheap code generation and the continuing
cost of good code fits this experience. Getting another effect implemented was
easy. Understanding its effect on the whole project took more attention.
Böckeler also notes the difficulty agents have in distinguishing important
conventions from habits. A test is helpful once I know which behaviour matters
and can describe it. Deciding whether the sky feels comfortable to leave open
was harder to turn into a check beforehand.

The course material on spec-driven development explains that unspecified
choices are filled using the model's learned priors (Swift, 2026). This gives
me one way to understand the visual changes. Each addition looked reasonable,
but the combined result moved away from what I wanted. My experience is too
limited to establish a general problem with harnesses. It does suggest that
an instruction like “make it calm” may leave important decisions unresolved,
even when the agent follows the request as well as it can.

I also need to be careful about trusting my own judgement. In METR's 2025
study, experienced developers took 19% longer using early-2025 AI tools, while
estimating that they had become 20% faster. METR's 2026 update suggests that
newer tools may improve speed, but still questions the reliability of people's
own estimates. Productivity and visual quality are different issues, so I
cannot use these findings as evidence about my design. They do encourage me
to look for a clearer basis for comparison. Using identical data in the old
and new versions helped me explain what I wanted changed.

A reasonable response is that this comparison should itself become part of
the harness. I agree. Rules written after the visual cleanup should help keep
later changes consistent. Böckeler also discusses inferential sensors, where
models review generated work. These might help assess qualities that ordinary
tests cannot easily cover. However, recording the outcome of my comparison
and making the original choice are different steps. A review can offer useful
feedback while still needing someone to decide how that feedback fits the
project.

The evidence for a continuously improving harness also seems limited. Swift's
(2026) evidence-of-practice material treats compound engineering as a claim
with limited support. Infralovers (2026) report reducing their configuration
after explicit instructions failed to prevent repeated mistakes. That is a
practitioner account, so I would not treat it as proof that smaller files
always work better. It does make me cautious about assuming that adding a rule
necessarily improves the next result. Böckeler's warning that model-based
checks are slower and less deterministic adds another reason to examine their
output carefully.

For now, I would keep using a harness to carry decisions forward. I would ask
for fewer changes at once, compare the results against an earlier version or
a clear goal, and record the reason behind each important rule. These are
changes I can justify from my own project. I am less confident that the same
process will eventually remove much of the judgement I need to contribute.

## References

Böckeler, B. (2026, April 2). *Harness engineering for coding agent users*. martinfowler.com. https://martinfowler.com/articles/harness-engineering.html

Infralovers. (2026, March 19). *Context engineering: Why less context makes better agents*. https://www.infralovers.com/blog/2026-03-19-context-engineering-weniger-kontext/

Klaassen, K. (n.d.). *Compound engineering*. Every. https://every.to/c/compounding-engineering

METR. (2025, July 10). *Measuring the impact of early-2025 AI on experienced open-source developer productivity*. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/

METR. (2026, February 24). *Uplift update*. https://metr.org/blog/2026-02-24-uplift-update/

Swift, B. (2026). *COMP4020/COMP8020 Agentic Coding Studio* [Course materials: "Spec-driven development"; "Evidence of practice"]. ANU School of Computing. https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/

Willison, S. (n.d.). Writing code is cheap now. In *Agentic engineering patterns*. https://simonwillison.net/guides/agentic-engineering-patterns/code-is-cheap/
