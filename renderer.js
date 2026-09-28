/* Tiny SVG flowchart + sequence-diagram renderer.
   Nodes are positioned by their centre (x, y). Edges route orthogonally between node sides. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  let uid = 0;

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function makeSvg(container, w, h, label, minW) {
    const svg = el("svg", {
      viewBox: `0 0 ${w} ${h}`,
      role: "img",
      "aria-label": label || "Diagram",
      style: `width:100%;max-width:${w}px;min-width:${minW || Math.min(w, 680)}px`,
    });
    const defs = el("defs", {}, svg);
    const id = ++uid;
    ["base", "fail", "ok", "loop", "human"].forEach((k) => {
      const m = el(
        "marker",
        {
          id: `ah-${k}-${id}`,
          viewBox: "0 0 10 10",
          refX: 9,
          refY: 5,
          markerWidth: 7,
          markerHeight: 7,
          orient: "auto-start-reverse",
        },
        defs,
      );
      el(
        "path",
        { d: "M0,0 L10,5 L0,10 z", style: `fill:var(${markerVar(k)})` },
        m,
      );
    });
    container.appendChild(svg);
    return { svg, id };
  }

  function markerVar(k) {
    return {
      base: "--muted",
      fail: "--fail",
      ok: "--ok",
      loop: "--agent",
      human: "--human",
    }[k];
  }

  function anchor(n, side, off = 0) {
    const hw = n.w / 2;
    const hh = n.h / 2;
    switch (side) {
      case "r":
        return [n.x + hw, n.y + off];
      case "l":
        return [n.x - hw, n.y + off];
      case "t":
        return [n.x + off, n.y - hh];
      default:
        return [n.x + off, n.y + hh];
    }
  }

  function autoSides(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["r", "l"] : ["l", "r"];
    return dy > 0 ? ["b", "t"] : ["t", "b"];
  }

  function routePoints(e, a, b) {
    let [fs, ts] = autoSides(a, b);
    fs = e.fs || fs;
    ts = e.ts || ts;
    const p1 = anchor(a, fs, e.fx);
    const p2 = anchor(b, ts, e.tx);
    if (e.via) return [p1, ...e.via, p2];
    const hf = fs === "l" || fs === "r";
    const ht = ts === "l" || ts === "r";
    if (hf && ht) {
      if (p1[1] === p2[1]) return [p1, p2];
      const mx = e.mid ?? (p1[0] + p2[0]) / 2;
      return [p1, [mx, p1[1]], [mx, p2[1]], p2];
    }
    if (!hf && !ht) {
      if (p1[0] === p2[0]) return [p1, p2];
      const my = e.mid ?? (p1[1] + p2[1]) / 2;
      return [p1, [p1[0], my], [p2[0], my], p2];
    }
    if (hf) return [p1, [p2[0], p1[1]], p2];
    return [p1, [p1[0], p2[1]], p2];
  }

  function drawLabel(g, pts, e) {
    if (!e.label) return;
    let x, y, anchorPos;
    if (e.lp) {
      [x, y] = e.lp;
      anchorPos = e.la || "middle";
    } else {
      let best = 0;
      let seg = [pts[0], pts[1]];
      for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(
          pts[i + 1][0] - pts[i][0],
          pts[i + 1][1] - pts[i][1],
        );
        if (len > best) {
          best = len;
          seg = [pts[i], pts[i + 1]];
        }
      }
      const horizontal = seg[0][1] === seg[1][1];
      x = (seg[0][0] + seg[1][0]) / 2;
      y = (seg[0][1] + seg[1][1]) / 2;
      if (horizontal) {
        y -= 7;
        anchorPos = "middle";
      } else {
        x += 7;
        y += 4;
        anchorPos = "start";
      }
    }
    const lines = String(e.label).split("\n");
    const t = el("text", { x, y, "text-anchor": anchorPos }, g);
    lines.forEach((line, i) => {
      const ts = el(
        "tspan",
        { x, dy: i === 0 ? -(lines.length - 1) * 13 : 13 },
        t,
      );
      ts.textContent = line;
    });
  }

  function drawNode(parent, n) {
    const g = el(
      "g",
      { class: `n k-${n.k || "plain"}`, "data-id": n.id },
      parent,
    );
    const x0 = n.x - n.w / 2;
    const y0 = n.y - n.h / 2;
    if (n.k === "decision" || n.shape === "diamond") {
      el(
        "polygon",
        {
          points: `${n.x},${y0} ${n.x + n.w / 2},${n.y} ${n.x},${y0 + n.h} ${x0},${n.y}`,
        },
        g,
      );
    } else {
      el(
        "rect",
        { x: x0, y: y0, width: n.w, height: n.h, rx: n.pill ? n.h / 2 : 9 },
        g,
      );
    }
    const titles = n.t ? String(n.t).split("\n") : [];
    const subs = n.s ? String(n.s).split("\n") : [];
    const total = titles.length * 16 + subs.length * 14;
    let y = n.y - total / 2 + 12;
    titles.forEach((line) => {
      const t = el(
        "text",
        { x: n.x, y, "text-anchor": "middle", class: "t" },
        g,
      );
      t.textContent = line;
      y += 16;
    });
    subs.forEach((line) => {
      const t = el(
        "text",
        { x: n.x, y: y + 1, "text-anchor": "middle", class: "s" },
        g,
      );
      t.textContent = line;
      y += 14;
    });
    if (n.title) el("title", {}, g).textContent = n.title;
  }

  function flow(container, spec) {
    const { svg, id } = makeSvg(
      container,
      spec.w,
      spec.h,
      spec.label,
      spec.minW,
    );
    const byId = {};
    const dw = spec.nodeW || 150;
    const dh = spec.nodeH || 58;
    spec.nodes.forEach((n) => {
      n.w = n.w || (n.k === "decision" ? dw + 40 : dw);
      n.h = n.h || (n.k === "decision" ? dh + 14 : dh);
      byId[n.id] = n;
    });

    (spec.lanes || []).forEach((l) => {
      const g = el("g", { class: `lane k-${l.k}` }, svg);
      el("rect", { x: 0, y: l.y, width: spec.w, height: l.h, rx: 10 }, g);
      const t = el("text", { x: 14, y: l.y + 20 }, g);
      t.textContent = l.label;
    });
    (spec.groups || []).forEach((gr) => {
      const g = el("g", { class: "grp" }, svg);
      el("rect", { x: gr.x, y: gr.y, width: gr.w, height: gr.h, rx: 12 }, g);
      const t = el("text", { x: gr.x + 12, y: gr.y + 18 }, g);
      t.textContent = gr.label;
    });
    (spec.heads || []).forEach((h) => {
      const t = el(
        "text",
        { x: h.x, y: h.y, "text-anchor": "middle", class: "colhead" },
        svg,
      );
      t.textContent = h.label;
    });

    const edgeLayer = el("g", {}, svg);
    const nodeLayer = el("g", {}, svg);
    spec.edges.forEach((e) => {
      const a = byId[e.from];
      const b = byId[e.to];
      if (!a || !b) return console.warn("bad edge", e);
      const kind = e.kind || "base";
      const cls = ["e", e.kind, e.dash ? "dash" : ""].filter(Boolean).join(" ");
      const g = el(
        "g",
        { class: cls, "data-id": e.id || `${e.from}-${e.to}` },
        edgeLayer,
      );
      const pts = routePoints(e, a, b);
      const attrs = {
        d: "M" + pts.map((p) => p.join(",")).join(" L"),
        "marker-end": `url(#ah-${kind}-${id})`,
      };
      if (e.both) attrs["marker-start"] = `url(#ah-${kind}-${id})`;
      el("path", attrs, g);
      drawLabel(g, pts, e);
    });
    spec.nodes.forEach((n) => drawNode(nodeLayer, n));
    return svg;
  }

  function sequence(container, spec) {
    const top = 14;
    const step = spec.step || 34;
    const h = top + 78 + spec.msgs.length * step + 16;
    const { svg, id } = makeSvg(container, spec.w, h, spec.label, spec.minW);
    const ax = {};
    spec.actors.forEach((a) => {
      ax[a.id] = a.x;
      el(
        "line",
        {
          x1: a.x,
          y1: top + 44,
          x2: a.x,
          y2: h - 8,
          style: "stroke:var(--border);stroke-width:1.5;stroke-dasharray:4 4",
        },
        svg,
      );
      drawNode(svg, {
        id: a.id,
        x: a.x,
        y: top + 22,
        w: a.w || 124,
        h: 44,
        k: a.k,
        t: a.label,
        s: a.sub,
      });
    });
    spec.msgs.forEach((m, i) => {
      const y = top + 78 + i * step;
      const kind = m.kind || "base";
      const g = el("g", { class: `e ${m.kind || ""}` }, svg);
      const x1 = ax[m.f];
      const x2 = ax[m.t];
      const label = `${i + 1}. ${m.label}`;
      if (m.f === m.t) {
        el(
          "path",
          {
            d: `M${x1},${y - 9} L${x1 + 34},${y - 9} L${x1 + 34},${y + 9} L${x1 + 5},${y + 9}`,
            "marker-end": `url(#ah-${kind}-${id})`,
          },
          g,
        );
        const t = el(
          "text",
          { x: x1 + 42, y: y + 4, "text-anchor": "start" },
          g,
        );
        t.textContent = label;
      } else {
        const dir = x2 > x1 ? 1 : -1;
        el(
          "path",
          {
            d: `M${x1},${y} L${x2 - dir * 3},${y}`,
            "marker-end": `url(#ah-${kind}-${id})`,
          },
          g,
        );
        const t = el(
          "text",
          { x: (x1 + x2) / 2, y: y - 7, "text-anchor": "middle" },
          g,
        );
        t.textContent = label;
      }
    });
    return svg;
  }

  window.Diagram = { flow, sequence };
})();
