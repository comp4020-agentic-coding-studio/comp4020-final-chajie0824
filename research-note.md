# What a harness can and cannot do

A common suggestion in agentic coding is to build a harness around the agent.
Böckeler (2026) describes guides, such as a `CLAUDE.md` file or a spec, that
steer its work, and sensors, such as tests, that check the result. Klaassen's
compound engineering suggests that recording lessons can make this process
improve over time and reduce the human work needed. I agree that recording
lessons helps, but I am less convinced about the second part. From working on
my final project, I think a harness can help preserve decisions, while deciding
what is good still needs human attention.

Willison (n.d.) argues that generating code has become cheap, while delivering
good code remains expensive. This distinction helped me understand my own
experience. The agent could quickly implement features, but checking whether
I wanted them took longer. Böckeler also points out that an agent may not know
which conventions are essential and which are habits. Tests help when someone
has already defined the expected behaviour. They offer less help when I am
still deciding what the result should feel like.

The course's notes on spec-driven development describe how a model fills gaps
in a spec using its learned priors (Swift, 2026). I saw a related problem in my
project. I asked for richer visuals and accepted several effects because each
looked reasonable on its own. Together, they made the sky too busy. I only
understood what bothered me after comparing the old and new versions with the
same data. This is one project, so it cannot show that harnesses generally
fail. It does show a limit I encountered: I could not write a useful rule about
an effect before I understood why I disliked it.

However, relying on my own impression also has problems. METR's 2025 trial
found that experienced developers took 19% longer with early-2025 AI tools,
although they believed the tools had made them 20% faster. Its 2026 update
suggests newer tools may speed developers up, while warning that estimates of
personal speedup remain unreliable. These studies concern productivity, rather
than visual design, so they do not directly prove anything about my sky. They
do give me a reason to be careful about saying a change is better just because
it feels better. Comparing versions gave me something more concrete to discuss
with the agent.

One objection to my argument is that I simply needed a better harness. Once I
had identified the visual problems, I could add rules against them. Böckeler's
inferential sensors, where a model reviews another model's output, could also
help with judgements that are difficult to test directly. I think these are
useful possibilities. Still, writing a rule after a comparison does not show
that the harness could have made the original decision.

There are also reasons to question whether adding more rules always helps.
The course's evidence-of-practice notes describe compound engineering as a
claim with limited supporting evidence (Swift, 2026). Infralovers (2026)
describe pruning their configuration after an agent repeated mistakes despite
explicit rules. Their account is practical experience rather than a controlled
study, but it challenges the assumption that a longer instruction file will
keep improving results. Model-based reviews also have limits: Böckeler notes
that they are slower and less deterministic. I would use them as another check,
but would still want to examine important decisions myself.

For my own work, this suggests three changes. First, I should request fewer
additions at once so I can judge their effects. Second, I should compare
versions or check the result against a clear project goal. Third, I should
keep rules focused on decisions I have actually made, with the failure that
explains each one. My project benefited from this kind of harness. I would
need more evidence before claiming that it can gradually take over the human
judgement involved.

## References

Böckeler, B. (2026, April 2). *Harness engineering for coding agent users*. martinfowler.com. https://martinfowler.com/articles/harness-engineering.html

Infralovers. (2026, March 19). *Context engineering: Why less context makes better agents*. https://www.infralovers.com/blog/2026-03-19-context-engineering-weniger-kontext/

Klaassen, K. (n.d.). *Compound engineering*. Every. https://every.to/c/compounding-engineering

METR. (2025, July 10). *Measuring the impact of early-2025 AI on experienced open-source developer productivity*. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/

METR. (2026, February 24). *Uplift update*. https://metr.org/blog/2026-02-24-uplift-update/

Swift, B. (2026). *COMP4020/COMP8020 Agentic Coding Studio* [Course materials: "Spec-driven development"; "Evidence of practice"]. ANU School of Computing. https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/

Willison, S. (n.d.). Writing code is cheap now. In *Agentic engineering patterns*. https://simonwillison.net/guides/agentic-engineering-patterns/code-is-cheap/
