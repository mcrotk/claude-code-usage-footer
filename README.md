# usage-footer

A [Claude Code](https://claude.com/claude-code) mod that keeps your context use and plan limits in view, under the prompt, where Claude Code otherwise shows only its own one-line footer.

```
⏵⏵ bypass permissions on (shift+tab to cycle) · Opus 5.5 · high effort
                                       160k / 1M (16%) · compacts at 967k
context ██████──────────────────────────────░░░        5h ██░░░░░░  12% resets Mon 20:40
■ system prompt 3k  ■ system tools 18k  ■ skills 6k  ■ messages 129k        7d ██████░░  73% resets Tue 17:00
```

In the terminal, each category has its own color in the bar and the legend, and the meters change color as they fill.

## What it shows

The footer adds three rows under Claude Code's own footer line, and two items at the end of that line. Claude Code's line itself (the permission mode, the background-agent count and so on) is left as it is.

- **Model and effort**, at the end of Claude Code's footer line, for example `Opus 5.5 · high effort`. The effort level is read from your settings when a session starts and then from each request Claude Code sends, so it follows `/effort` and `/model` changes.
- **Context figures:** the tokens in use, the model's context window, the percentage used, and the token count at which auto-compaction runs. The percentage turns yellow at 70% of the way to the auto-compact point and red at 90%.
- **Context bar:** the window split by category in the colors `/context` uses (system prompt, system tools, MCP tools, memory files, skills, messages, and so on), then the free space (`─`), then the auto-compact buffer (`░`) at the far end.
- **Legend:** each category with its tokens. In a narrow terminal the smallest categories are merged into "other", and the bar shrinks to match.
- **Plan limits:** the 5-hour and 7-day usage limits, each with the percentage used and when it resets, in your local time. The 5-hour meter is green, then yellow from 75%; the 7-day meter is blue, then orange from 75%. Both turn red from 90%.

The context figures come from the same breakdown `/context` uses, estimated locally: the mod makes no API calls and sends nothing anywhere. The limits are the figures Claude Code receives with each reply. They appear only on a Claude subscription; elsewhere the meters show `–`.

## Installing

At the prompt of a Claude Code session in a terminal, run:

```
/plugin install usage-footer --marketplace mcrotk/claude-code-usage-footer
```

Answer `y` to add the marketplace, then choose a scope (the user scope makes it load in every session). The footer appears right away in that session.

From a shell, the equivalent is:

```
claude plugin install usage-footer --marketplace mcrotk/claude-code-usage-footer
```

Requirements and caveats:

- Mods are an early-access part of Claude Code, and their API may change between releases. This mod was written and tested on Claude Code 2.1.325, on macOS in iTerm2.
- It is built for the terminal. It draws through the component under the prompt (`PromptHint`), which other surfaces may draw differently or not at all.

To remove it, run `/plugin uninstall usage-footer`.

## Adjusting it

This section lists the settings near the top of `hooks/register.tsx` that are easiest to change. If you run the mod from a folder of your own (for example with `CLAUDE_CODE_PLUGIN_DIRS` pointing at a clone), Claude Code reloads it whenever you save.

- `GAP`: the space between the context part and the limit meters.
- `LIMIT_BAR` and `MIN_BAR`: the width of each limit meter's bar, and the narrowest the context bar may get.
- `FIRST_LIMIT` and `SECOND_LIMIT`: each meter's colors below and above its warning point; `LIMIT_WARN_AT` and `LIMIT_ERROR_AT` set where the colors change.
- `CATEGORY_COLORS`: colors used in place of the theme's for particular categories. By default "System tools" is blue, because some themes draw it in the same grey as "System prompt".

After a change, `claude plugin validate <folder>` checks the module (including its types) the way Claude Code will load it.

## License

MIT; see [LICENSE](LICENSE).
