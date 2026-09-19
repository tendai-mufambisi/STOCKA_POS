# UI/UX overhaul prompt (portable)

Paste everything below the line into the other project. It assumes nothing about
that codebase — it tells you to go and find out first.

---

You are working on a desktop Electron app that I own. I have just finished a
UI/UX overhaul on a different app of mine and I want the same work done here,
adapted to this codebase rather than copied into it.

## How to work

1. **Survey before you change anything.** Read the renderer source: how pages are
   composed, how state is held, what the stylesheets look like, how forms,
   overlays and messages are done today. Then tell me, in plain language, which
   of the items below this app actually suffers from, which it already does
   well, and which do not apply. Do not start editing until I have seen that list
   and told you where to start.
2. **Adapt, do not transplant.** Match the existing naming, file layout, state
   library and CSS conventions of this project. If this app uses plain CSS, write
   plain CSS; if it uses Tailwind or CSS modules, use that. If it is not React,
   translate the idea, not the code.
3. **One theme per commit**, in small steps I can test between. Each commit
   message says what was wrong before, in one or two sentences, then what it does
   now. No bullet lists of file names.
4. **Never restyle by guessing.** Run the app and look at the screen before and
   after. If you cannot run it, say so instead of claiming it works.
5. **Leave a short comment at the top of each new shared component** explaining
   why it exists — the specific mess it replaces. Future readers need the reason,
   not a description of the props.
6. **Assume the stylesheets are one global namespace** until you have proved
   otherwise. Early on, grep for generic class names used in more than one file
   (`.modal-header`, `.form-group`, `.card`, `.btn`, `.error-msg`) and list the
   collisions. In a single bundle the last stylesheet loaded wins, so a new
   component using a generic name will be restyled at random by whichever page
   happens to be imported after it. Also check for stylesheets nothing imports:
   importing one "to use its classes" can silently restyle dozens of elements
   elsewhere.
7. **Do not rename ids, routes, permission keys or database fields** while
   changing how things look. Labels on screen are free to change; identifiers are
   not — permissions, deep links, notifications and saved preferences are keyed
   on them.

## The work

### 1. The height chain, and scrolling only what should scroll

Check whether `html`, `body` and the mount node (`#root` or equivalent) have a
definite height. If they do not, every `height: 100%` below them resolves to
`auto`, the whole document scrolls, and page headers, toolbars, filter bars and
table headings all scroll away with the rows. Fix:

- `html, body, #root { height: 100% }`.
- Do NOT put `overflow: hidden` on `body` — any screen outside the main shell
  (sign-in, setup, activation) legitimately needs the document to scroll on a
  short window. Containment starts at the app shell element.
- Turn each list page into a full-height flex column (`display:flex;
  flex-direction:column; height:100%; min-height:0`), with the table's wrapper as
  the single scroll container (`flex:0 1 auto; min-height:0; overflow:auto`).
- Sticky table headings: `th { position: sticky; top: 0; z-index: 2; background: <solid> }`.
  Switch the table to `border-collapse: separate; border-spacing: 0`, because a
  stuck header loses its bottom rule in `collapse` mode; move row dividers from
  `<tr>` onto `<td>`.
- Make the scroll container the bordered/rounded card itself, so rows do not
  slide underneath the card's corners.
- In the app shell, keep the top header outside the scrolling box so it stays put.

### 2. One dialog component, portalled

Look for hand-rolled fixed overlays — there are usually several, each slightly
different. Replace them with a single `Modal`:

- Rendered through a portal to `document.body`, so no ancestor's `overflow`,
  `transform` or stacking context can clip or mis-layer it.
- **Escape closes only the topmost dialog.** Keep a module-level stack of open
  dialog ids; a dialog ignores the key unless it is last. Listen on `window` in
  the **capture** phase and `stopPropagation`, so a page that also listens for
  Escape (a cart, a search box) does not act on the same keypress.
- **Focus trap**: Tab and Shift+Tab cycle inside; on open, focus the dialog box
  itself, not the close button (a focus ring on the × reads as "this is what you
  want"); on close, return focus to whatever opened it. Skip the auto-focus if
  something inside already claimed it via `autoFocus`.
- **Read `onClose` through a ref** and make the setup effect depend only on
  `open`. If the effect depends on the handler, every keystroke in a form tears
  the dialog down and rebuilds it, and focus jumps out of the field being typed in.
- **Body scroll lock must be ref-counted**, or closing a nested dialog unlocks
  the page while the outer one is still up.
- **Backdrop dismisses on `mousedown`, not `click`**: a drag that starts inside a
  text input and releases over the backdrop must not close the dialog and lose
  what was typed.
- **Namespace the classes** (`smodal-*` or similar). Do not reuse generic names
  like `.modal-header` / `.modal-footer` — in a single bundle, some page's
  stylesheet redefines them globally and wins, which is how a dialog ends up with
  invisible buttons.
- Props worth having: `open, title, subtitle, size, level (z-index), onClose,
  closeOnBackdrop, closeOnEsc, showClose, footer, initialFocusRef,
  className/overlayClassName that REPLACE the defaults` — that last one lets an
  existing bespoke dialog keep its exact look while gaining the portal, the trap
  and Escape.
- Then move existing confirm/alert dialogs onto it **keeping their props
  identical**, so their call sites do not change.
- Replace any native `alert`/`confirm`/`dialog.showMessageBox` used for in-app
  decisions with this dialog. A native OS box in the middle of an app flow looks
  like a system error.
- Take an inventory of the z-index values already in the app before choosing
  the dialog's and the toast host's. Pick numbers above the current maximum, and
  give nested dialogs an explicit level so a confirm always sits over the form
  that raised it.
- **Dropdowns, pickers and autocomplete lists inside a dialog get clipped** by
  the dialog's own scrolling body, so the list opens below the visible area and
  looks empty or missing. Either scroll the open list into view, or render the
  list in a portal positioned against its trigger. Test with a picker near the
  bottom of a long form, which is where it always breaks.
- A search box inside a dialog form must swallow Enter (`preventDefault`), or
  typing a search term and pressing Enter submits the whole form.

### 3. Toasts instead of in-page banners

Find where the app reports "saved", "failed", "created". If those render in page
flow, they shove the layout as they appear and vanish, and on a scrolled page the
user never sees them at all.

- A tiny store (whatever state library the app already uses) plus an imperative
  façade importable from anywhere: `toast.success(msg, opts)`, `.error`, `.info`,
  `.dismiss`, `.clear`. A façade, not a hook/context, so a service or an event
  handler three levels deep can call it with no prop drilling.
- `opts: { detail, action: { label, onClick }, duration }`.
- Defaults: success/info ~4s, error ~7s; `duration <= 0` means it stays until
  dismissed by hand.
- **Dedupe**: the same type+message within ~600ms refreshes the existing toast
  instead of stacking a copy — guards against double-clicks and React
  StrictMode's double-invoke in dev.
- Cap at ~4 on screen; beyond that it is noise.
- Draw the host above everything (z-index above dialogs) so a dialog can raise a
  toast over itself.
- Migrate cheaply: where a page has its own `flash(type, msg)` / `setMessage`
  helper with dozens of call sites, re-point the helper's body at the toast
  façade first and leave the call sites alone. Then delete the banner state and
  its markup. Do the call sites later, one page at a time, if at all.
- Then delete the per-page banner states and their stylesheet copies.
- Watch for double messages afterwards: a generic "Done." from a wrapper plus a
  specific "X saved" from the caller. Pick one, usually the specific one.

### 4. One form field component

Count the input rule-sets across the stylesheets; in my other app there were
about forty, with seven different ideas of what focus looks like, and no way for
a single field to say "this one is wrong" — so every validation failure became a
banner at the top of a scrolled page.

Build one `Field`:

- **Floating label**: label sits inside the box like a placeholder and slides up
  to a caption on focus or when filled. Saves vertical space and you never lose
  track of which box you are in. Keep it permanently floated for controls that
  always display something (`date`, `time`, `file`, `color`, …).
- **Focus edge** that draws round from where the pointer went down, then settles
  into a soft glow. CSS animation, not an SVG per input — there may be hundreds.
- **Invalid**: red edge, the reason underneath the field, and a short shake.
  Provide a `shakeKey` prop so re-submitting the same error replays the shake.
- Support `as: 'input' | 'select' | 'textarea'`, `prefix`/`suffix` (e.g. `$`),
  `hint`, `required`.
- Move validation messages out of page-level banners and onto the field that
  needs fixing.
- Add a `Stepper` if there are any multi-step flows.

### 5. Forms as dialogs

Any form that opens inline above a table and pushes the table down the page
should open as a dialog instead, built on `Field`, with errors on the field and a
toast naming what was saved. Where a form is long, split it into two steps with
the `Stepper` and save from the last one; switching a mode inside the form must
keep what is already filled in. Where a form needs a record that does not exist
yet (a supplier, a category), let the user add it without leaving: a button
beside the picker, an add row at the foot of the list, and Enter in the search
box picking the match or offering to create the typed name — and if the name
already exists, select it rather than making a duplicate.

### 6. Settings should read as a record, not a page of live inputs

If Settings is permanently editable, it can be changed by accident and nothing
shows what is actually saved. Each section becomes a read-only record with an
Edit button; Save and Cancel appear only while editing; Cancel restores the saved
values. Only one section editable at a time when several write the same record,
and leaving a section mid-edit asks before discarding. A PIN or password gets no
read-only view — only a Change form. Results arrive as toasts.

### 7. Navigation: daily work first

If the sidebar lists every page flat, the handful used daily are lost among the
ones opened monthly. Structure: the primary action, Home, then an "Every day"
group of the jobs done each shift, then a small number of **areas** that open
into their own inner menu, then Settings at the bottom beside the signed-in user.
Each area remembers the page last opened in it. Rename anything jargonish to what
the user would say out loud. **Keep page ids unchanged** so permissions, deep
links and shortcuts keep working. Merge any two pages that show the same data
from two angles into one page with a tab each.

Two checks people skip. **The whole sidebar must fit on the smallest screen the
app runs on without scrolling** — count the rows at that height, including any
footer, and shrink the row height rather than let items hide below the fold; a
navigation item you have to scroll to find is no better than a buried one. And
if an item is permitted per-role, make sure a role that can see only part of a
merged page still gets that part, and that a role with none of it never sees the
entry at all.

### 8. Motion, and restraint

- Overlay fade ~0.18–0.2s ease-out; dialog rise ~0.22–0.3s
  `cubic-bezier(0.2, 0.9, 0.3, 1)`; toast in ~0.22s the same curve.
- Hover/active transitions ~0.14s on `background`, `border-color`, `color`,
  `transform`, `box-shadow`. Never `transition: all`.
- **Every animation gets a `@media (prefers-reduced-motion: reduce)` block that
  turns it off.** No exceptions.
- Motion is for orienting the eye — something arriving, leaving, or being wrong.
  Nothing decorative, nothing that delays a response to a keypress.

### 9. Keyboard first

These machines have a keyboard and a mouse and no touchscreen. Every flow must be
completable without the mouse: Enter submits and confirms the default action,
Escape backs out one level, Tab order follows the visual order, and the control
the user needs next holds focus when a screen or dialog opens. Do not remove
focus outlines — restyle them.

### 10. Prove each change on screen

"It compiles" is not evidence about an interface. Before you tell me a piece is
done, drive it and look at it.

- If you can drive the running app, do that. Otherwise build a throwaway preview:
  a small entry file that renders one component or page, stubbed data behind a
  proxy standing in for the app's data layer, served over HTTP (ES modules are
  blocked on `file://`), captured with the framework's screenshot call. Delete
  the harness afterwards; it is scaffolding, not a feature.
- Script the interaction rather than describing it: click the button, type into
  field one, click field two, type again, read back which element holds focus
  and what each field contains. That is how the focus bug in §2 was found, and
  the same script proves the fix.
- A hidden or offscreen window may hand you a frame that is one step stale.
  Force a repaint and pause before capturing, or you will chase highlights that
  are not really there.
- Test at the smallest window the app supports, with a long list and an empty
  list, and with the least-privileged role — not only as an admin with rich data.
- Run the project's linter, tests and a production build before each commit, and
  quote the result. If something fails, say so with the output rather than
  working around it quietly.

### 11. Shipping

Group the finished work into one commit per theme, in an order where each commit
still builds — shared pieces first, then what depends on them. Say plainly which
parts you verified by driving the app and which you only reasoned about, and
flag anything that writes to real data as worth a manual pass before release. If
the app ships updates to real users, follow this project's existing release
steps exactly, and afterwards confirm that what is published is the build you
just made — same version, same size — rather than assuming the upload was fresh.

## What I care about

Correctness of the interaction, not decoration. A dialog that loses your typing,
a confirmation nobody can see, a table heading that scrolls away while you are
reading the column, a number that is wrong but looks right — those are the bugs.
If you find something in that class that I have not listed, tell me.
