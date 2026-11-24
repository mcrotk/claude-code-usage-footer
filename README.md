# usage-footer

A [Claude Code mod](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods) that keeps your context use and plan limits in view, under the prompt, where Claude Code otherwise shows only its own one-line footer. The mod's name is `usage-footer`; this repository, `claude-code-usage-footer`, is where it's installed from.

![The footer under the Claude Code prompt. Claude Code's own line, which shows the permission mode, ends with "Opus 5.5 · high effort". Below it are the context figures (284k of 1M tokens in use, 28%, compacting at 967k), a bar split into colored categories with a long magenta stretch for messages, a legend of the categories with their tokens, and on the right the 5-hour meter (green, 11%) and the 7-day meter (orange, 76%) with their reset times.](images/footer.png)

The screenshot shows the footer in iTerm2 with Claude Code's `dark-ansi` theme. The 7-day meter is orange because it has passed 75% of its limit; below that it is blue.

## Features

The footer adds three rows under Claude Code's own footer line, and two items at the end of that line. Claude Code's line itself (the permission mode, the background-agent count and so on) is left as it is.

- **Model and effort.** The model and the effort level are added at the end of Claude Code's footer line, for example `Opus 5.5 · high effort`. The effort level is read from your settings when a session starts and then from each request Claude Code sends, so it follows `/effort` and `/model` changes.
- **Context figures.** The first new row shows the tokens in use, the model's context window, the percentage used, and the token count at which auto-compaction runs. The percentage turns yellow at 70% of the way to the auto-compact point and red at 90%.
- **Context bar.** The bar shows the window split by category, in the colors `/context` uses (system prompt, system tools, MCP tools, memory files, skills, messages, and so on). The free space (`─`) comes next, and the auto-compact buffer (`░`) is at the far end.
- **Legend.** The row under the bar lists each category with its tokens. In a narrow terminal, the smallest categories are merged into "other", and the bar shrinks to match.
- **Plan limits.** Beside the bar and the legend are meters for the 5-hour and 7-day usage limits, each with the percentage used and the time it resets, in your local time. The 5-hour meter is green, then yellow from 75%; the 7-day meter is blue, then orange from 75%. Both turn red from 90%.

The context figures come from the same breakdown `/context` uses, estimated locally: the mod makes no API calls and sends nothing anywhere. The limits are the figures Claude Code receives with each reply, and Claude only sends them to people using Claude Code through a Claude subscription, such as a Pro or Max plan. With an API key or a cloud provider, there are no such limits to show, so each meter shows only a dash after its label instead of a bar and its figures.

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

## Customization

This section lists the constants near the top of `hooks/register.tsx` that are easiest to change. If you run the mod from a folder of your own (for example with `CLAUDE_CODE_PLUGIN_DIRS` pointing at a clone), Claude Code reloads it whenever you save.

- `GAP` sets the space between the context part and the limit meters.
- `LIMIT_BAR` sets the width of each limit meter's bar, and `MIN_BAR` sets the narrowest the context bar may get.
- `FIRST_LIMIT` and `SECOND_LIMIT` set each meter's colors below and above its warning point, and `LIMIT_WARN_AT` and `LIMIT_ERROR_AT` set where the colors change.
- `CATEGORY_COLORS` gives colors to use in place of the theme's for particular categories. By default "System tools" is blue, because some themes draw it in the same grey as "System prompt".

After a change, `claude plugin validate <folder>` checks the module (including its types) the way Claude Code will load it.

## License

Released under the MIT License; see [LICENSE](LICENSE) for the full text.
