/* Page behaviour: render diagrams, stepper, tabs, guard simulator, scroll-spy, theme. */
(function () {
  /* ---------- Diagrams ---------- */
  const svgs = {};
  document.querySelectorAll("[data-diagram]").forEach((box) => {
    const key = box.dataset.diagram;
    const spec = window.DIAGRAMS[key];
    if (!spec) return;
    const svg =
      spec.type === "sequence"
        ? Diagram.sequence(box, spec)
        : Diagram.flow(box, spec);
    svgs[key] = svg;
  });

  /* ---------- Stepper (walk through a diagram) ---------- */
  document.querySelectorAll("[data-stepper]").forEach((wrap) => {
    const key = wrap.dataset.stepper;
    const steps = window.DIAGRAMS[key].steps;
    const svg = svgs[key];
    const prev = wrap.querySelector("[data-prev]");
    const next = wrap.querySelector("[data-next]");
    const all = wrap.querySelector("[data-all]");
    const count = wrap.querySelector(".count");
    const caption = document.querySelector(`[data-caption="${key}"]`);
    let i = -1;

    function show() {
      svg.querySelectorAll(".on").forEach((n) => n.classList.remove("on"));
      if (i < 0) {
        svg.classList.remove("stepping");
        caption.innerHTML =
          "<b>Press “Next” to walk the pipeline one stage at a time.</b>Each step lights up who acts (lane colour) and what happens.";
        count.textContent = `0 / ${steps.length}`;
      } else {
        const s = steps[i];
        svg.classList.add("stepping");
        s.on.forEach((id) =>
          svg
            .querySelectorAll(`[data-id="${id}"]`)
            .forEach((n) => n.classList.add("on")),
        );
        const esc = (str) =>
          str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        caption.innerHTML = `<b>${esc(s.t)}</b>${esc(s.d)}`;
        count.textContent = `${i + 1} / ${steps.length}`;
      }
      prev.disabled = i < 0;
      next.disabled = i >= steps.length - 1;
    }
    prev.addEventListener("click", () => {
      i--;
      show();
    });
    next.addEventListener("click", () => {
      i++;
      show();
    });
    all.addEventListener("click", () => {
      i = -1;
      show();
    });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" && !next.disabled) next.click();
      if (e.key === "ArrowLeft" && !prev.disabled) prev.click();
    });
    show();
  });

  /* ---------- Tabs ---------- */
  document.querySelectorAll("[data-tabs]").forEach((group) => {
    const buttons = group.querySelectorAll('[role="tab"]');
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => {
          const on = b === btn;
          b.setAttribute("aria-selected", String(on));
          document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
        });
      });
    });
  });

  /* ---------- guard-bash.sh simulator (a JS port of the hook's rules) ---------- */
  const reDefault = /^(refs\/heads\/)?(main|master)$/;
  const reForce =
    /^(-f|--force|--force-with-lease.*|--force-if-includes|--mirror|\+.*)$/;
  const reProtectWrite =
    /\s(-X|--method|-f|-F|--field|--raw-field|--input)([\s=]|$)/;

  function guard(raw, branch) {
    let cmd = raw;
    if (!/(^|[^\w])(ba|z)?sh[^|;&]*<</.test(cmd)) {
      cmd = cmd.replace(
        /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2(?=\n|$)/g,
        "$3",
      );
    }
    const unquoted = cmd
      .replace(/'[^']*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    cmd = /(^|[^\w])((ba|z)?sh|eval)(\s|$)/.test(unquoted)
      ? cmd.replace(/["']/g, "\n")
      : unquoted;

    const parts = cmd.split(/&&|\|\||;|\||\$\(|`|\{|\n/);
    for (let part of parts) {
      part = part
        .replace(/^[\s(]+/, "")
        .replace(/^([A-Za-z_]\w*=\S*\s+)+/, "")
        .replace(/^((sudo|command|exec|time|env|nohup)\s+)+/, "")
        .replace(/^git(\s+-[Cc]\s+\S+)+/, "git")
        .trim();
      if (/^gh\s+pr\s+merge/.test(part)) return "merging a PR";
      if (/^gh\s+api/.test(part)) {
        if (/\/pulls\/\d+\/merge|\/merges(['"\s]|$)/.test(part))
          return "merging via the API";
        if (/\/protection/.test(part) && reProtectWrite.test(part))
          return "changing branch protection";
      }
      if (!/^git\s+push(\s|$)/.test(part)) continue;
      const args = part
        .replace(/^git\s+push/, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const positional = [];
      for (const a of args) {
        if (reForce.test(a)) return `force-pushing (${a})`;
        if (a.startsWith("-")) continue;
        positional.push(a);
        const dest = a.includes(":") ? a.slice(a.lastIndexOf(":") + 1) : a;
        if (reDefault.test(dest)) return `pushing to ${dest}`;
      }
      if (reDefault.test(branch)) {
        if (positional.length < 2)
          return `pushing from ${branch} with no target branch`;
        for (const a of positional.slice(1)) {
          if (a.split(":")[0] === "HEAD" && !a.includes(":"))
            return `pushing HEAD while on ${branch}`;
        }
      }
    }
    return null;
  }

  const deny = [
    "gh pr merge",
    "git push --force",
    "git push -f",
    "git push origin main",
    "git push origin master",
  ];
  const ask = [
    "npm install",
    "npm i",
    "npm uninstall",
    "git push",
    "gh pr create",
  ];
  const startsWord = (cmd, p) => cmd === p || cmd.startsWith(p + " ");

  function evaluate(cmd, branch) {
    const c = cmd.trim();
    if (!c) return null;
    const blocked = guard(c, branch);
    if (blocked) {
      return {
        cls: "block",
        text: `✖ BLOCKED by guard-bash.sh (exit 2): ${blocked}.\n  Claude reads: "Push a feature branch and open a PR; a human merges it."`,
      };
    }
    const d = deny.find((p) => startsWord(c, p));
    if (d)
      return {
        cls: "block",
        text: `✖ DENIED by settings.json → permissions.deny: Bash(${d}:*)`,
      };
    const a = ask.find((p) => startsWord(c, p));
    if (a)
      return {
        cls: "ask",
        text: `? ASKS the human first: settings.json → permissions.ask: Bash(${a}:*)`,
      };
    return {
      cls: "allow",
      text: "✔ ALLOWED: the hook exits 0 and no permission rule matches.",
    };
  }

  const input = document.getElementById("guard-input");
  const branchSel = document.getElementById("guard-branch");
  const out = document.getElementById("guard-out");
  if (input) {
    const run = () => {
      const r = evaluate(input.value, branchSel.value);
      if (!r) {
        out.hidden = true;
        return;
      }
      out.hidden = false;
      out.className = `verdict ${r.cls}`;
      out.textContent = r.text;
    };
    input.addEventListener("input", run);
    branchSel.addEventListener("change", run);
    document.querySelectorAll("[data-cmd]").forEach((chip) =>
      chip.addEventListener("click", () => {
        input.value = chip.dataset.cmd;
        if (chip.dataset.branch) branchSel.value = chip.dataset.branch;
        run();
      }),
    );
  }

  /* ---------- Scroll-spy for the sidebar ---------- */
  const links = [...document.querySelectorAll(".toc a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.classList.remove("active"));
        byId.get(e.target.id)?.classList.add("active");
      });
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  document.querySelectorAll("main section[id]").forEach((s) => io.observe(s));

  /* ---------- Mobile menu ---------- */
  const sidebar = document.querySelector(".sidebar");
  document
    .querySelector(".menu-btn")
    .addEventListener("click", () => sidebar.classList.toggle("open"));
  links.forEach((a) =>
    a.addEventListener("click", () => sidebar.classList.remove("open")),
  );

  /* ---------- Theme toggle ---------- */
  const root = document.documentElement;
  const btn = document.querySelector(".theme-btn");
  try {
    const saved = localStorage.getItem("pipeline-theme");
    if (saved) root.dataset.theme = saved;
  } catch (_) {}
  btn.addEventListener("click", () => {
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("pipeline-theme", root.dataset.theme);
    } catch (_) {}
  });
})();
