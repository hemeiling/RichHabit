import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Segmented } from "../src/components/ui";

/**
 * `Segmented` — every On/Off and option row in the app — says which option is
 * chosen to assistive technology, not only by colour: each option is a real
 * button (Tab, Enter and Space work natively) with `aria-pressed`. The
 * `data-on` styling hook stays as it was.
 */
describe("Segmented accessibility", () => {
  const html = (value: boolean) => renderToStaticMarkup(createElement(Segmented<boolean>, {
    value, onChange: () => {}, options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  }));

  it("announces the chosen option as pressed, the other as not", () => {
    const on = html(true);
    expect(on).toMatch(/<button type="button" class="chip" data-on="true" aria-pressed="true"[^>]*>On<\/button>/);
    expect(on).toMatch(/<button type="button" class="chip" data-on="false" aria-pressed="false"[^>]*>Off<\/button>/);
    expect(html(false)).toMatch(/aria-pressed="true"[^>]*>Off</);
  });

  it("keeps exactly one option pressed, as buttons (keyboard-operable), with no extra roles", () => {
    const out = html(true);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out.match(/<button type="button"/g)).toHaveLength(2);
    expect(out).not.toMatch(/role=|tabindex=/);
  });
});
