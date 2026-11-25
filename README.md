# usage-footer

A [Claude Code mod](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods) that keeps your context use and your plan limits or costs in view, under the prompt, where Claude Code otherwise shows only its own one-line footer. The mod's name is `usage-footer`; this repository, `claude-code-usage-footer`, is where it's installed from.

![The footer under the Claude Code prompt. Claude Code's own line, which shows the permission mode, ends with "Opus 5.5 · high effort". Below it are the context figures (284k of 1M tokens in use, 28%, compacting at 967k), a bar split into colored categories with a long magenta stretch for messages, a legend of the categories with their tokens, and on the right the 5-hour meter (green, 11%) and the 7-day meter (orange, 76%) with their reset times.](images/footer.png)

The screenshot shows the footer in iTerm2 with Claude Code's `dark-ansi` theme. The 7-day meter is orange because it has passed 75% of its limit; below that it is blue.

## Features

The footer adds three rows under Claude Code's own footer line, and two items at the end of that line. Claude Code's line itself (the permission mode, the background-agent count and so on) is left as it is.

- **Model and effort.** The model and the effort level are added at the end of Claude Code's footer line, for example `Opus 5.5 · high effort`. The effort level is read from your settings when a session starts and then from each request Claude Code sends, so it follows `/effort` and `/model` changes.
- **Context figures.** The first new row shows the tokens in use, the model's context window, the percentage used, and the token count at which auto-compaction runs. The percentage turns yellow at 70% of the way to the auto-compact point and red at 90%.
- **Context bar.** The bar shows the window split by category, in the colors `/context` uses (system prompt, system tools, MCP tools, memory files, skills, messages, and so on). The free space (`─`) comes next, and the auto-compact buffer (`░`) is at the far end.
- **Legend.** The row under the bar lists each category with its tokens. In a narrow terminal, the smallest categories are merged into "other", and the bar shrinks to match.
- **Limits or costs.** A column on the right shows what you can run out of, which depends on how Claude Code is billed for you. The next section describes it.

The context figures come from the same breakdown `/context` uses, estimated locally: the mod makes no API calls and sends nothing anywhere.

### Limits and costs

The right-hand column takes one of three forms, and the mod works out which one applies by itself.

- **On a Claude subscription,** such as a Pro or Max plan, it shows meters for the 5-hour and 7-day usage limits beside the bar and the legend, as in the screenshot. Each meter has the percentage used and the time it resets, in your local time. The 5-hour meter is green, then yellow from 75%; the 7-day meter is blue, then orange from 75%. Both turn red from 90%. Claude sends these figures with each reply, so until the first reply of a session, each meter shows only a dash after its label.
- **When Claude Code is billed per token,** there are no such limits, so the column shows what your use has cost instead: this session, this week (from Monday) and this month, on three rows such as `session ≈ $1.84`, `week ≈ $23.10` and `Nov ≈ $84.20`. That's the case when you use Claude Code with an API key, through a company gateway, or through a cloud provider such as Amazon Bedrock, Google Vertex AI or Microsoft Foundry. The mod recognizes it from the settings Claude Code itself uses for those setups; it only checks whether they are set, and never keeps or shows their values. Where none of those settings is used, as with a Claude Console sign-in, the mod switches to the cost rows once a reply has come back without any limit figures, since a subscription always gets them with the first reply.
- **When a company gateway sets a spend limit,** which is a daily, weekly or monthly cap in dollars, the column shows this session's cost, this month's cost, and a meter for the limit with the date it resets. Claude Code tells mods how much of the limit is used and when it resets, but not the limit's period or size, so the reset date is what shows whether the limit runs by calendar month.

The costs are estimates at Anthropic's list prices, the same ones `/cost` uses, which is why they're marked with "≈". A cloud provider's prices or a negotiated discount can make the actual bill different.

The session's cost is Claude Code's own figure for the session. The week's and month's totals are kept by the mod, which has two consequences:

- The totals only include spending from the time the mod started tracking it, which is when you installed it or updated it to version 0.2.0. In a session that was already running at that point, only what it spends afterwards is counted. The first week's and month's totals are therefore partial.
- The totals only include sessions that ran with the mod on the same computer. Spending on other computers, through other tools, or by other people on the same account isn't included.

### Previewing the other forms

To see how the cost and spend-limit columns look without that setup, run `/usage-footer-preview cost` or `/usage-footer-preview spend` in a session, and `/usage-footer-preview off` to go back. The cost preview uses your real figures; on a subscription, those are only what your use would cost at API prices. The spend preview shows a made-up limit, 42% used and resetting at the start of next month, unless a real one has arrived. A preview lasts only for the session it's run in.

## Installation

At the prompt of a Claude Code session in a terminal, run:

```
/plugin install usage-footer --marketplace mcrotk/claude-code-usage-footer
```

Answer `y` to add the marketplace, then choose a scope (the user scope makes it load in every session). The footer appears right away in that session.

From a shell, the equivalent is:

```
claude plugin install usage-footer --marketplace mcrotk/claude-code-usage-footer
```

There are two things to be aware of before installing it:

- Mods are an early-access part of Claude Code, and their API may change between releases. They need Claude Code 2.1.287 or later, the first version in which mods load by default. This mod was written and tested on Claude Code 2.1.325, on macOS in iTerm2.
- The mod is built for the terminal. It draws through the component under the prompt (`PromptHint`), which other surfaces may draw differently or not at all.

To remove it, run `/plugin uninstall usage-footer`.

### Updating

Claude Code can keep the mod up to date by itself, or you can update it by hand.

To have it update automatically, turn on auto-update for this repository's marketplace: run `/plugin`, open the list of marketplaces, choose `claude-code-usage-footer`, and select "Enable auto-update". Claude Code then checks for a new version of the mod each time it starts.

To update by hand, refresh Claude Code's copy of this repository, and then update the mod:

```
claude plugin marketplace update claude-code-usage-footer
claude plugin update usage-footer@claude-code-usage-footer
```

The first command is needed because `claude plugin update` only checks the copy of this repository that Claude Code downloaded when you installed the mod; without it, the update reports that you already have the latest version. After updating, restart any Claude Code sessions that are running, for example by exiting and resuming them.

The [releases page](https://github.com/mcrotk/claude-code-usage-footer/releases) lists what changed in each version.

## Customization

This section lists the constants near the top of `hooks/register.tsx` that are easiest to change. If you run the mod from a folder of your own (for example with `CLAUDE_CODE_PLUGIN_DIRS` pointing at a clone), Claude Code reloads it whenever you save.

- `GAP` sets the space between the context part and the right-hand column.
- `LIMIT_BAR` sets the width of each limit meter's bar, and `MIN_BAR` sets the narrowest the context bar may get.
- `FIRST_LIMIT`, `SECOND_LIMIT` and `SPEND_LIMIT` set the colors of the 5-hour, 7-day and spend-limit meters below and above their warning point, and `LIMIT_WARN_AT` and `LIMIT_ERROR_AT` set where the colors change.
- `CATEGORY_COLORS` gives colors to use in place of the theme's for particular categories. By default "System tools" is blue, because some themes draw it in the same grey as "System prompt".

After a change, `claude plugin validate <folder>` checks the module (including its types) the way Claude Code will load it.

## License

Released under the MIT License; see [LICENSE](LICENSE) for the full text.
