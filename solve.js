// A fast drop-in for makefun-diff 1.0.0: same patch, byte for byte, much less CPU.
//
// The reference (vendor/makefun-diff) runs Myers's greedy search with a linked
// list of path components allocated for every (d, k) step. This module keeps
// the exact same search -- same diagonals, same deletion-on-tie rule, same
// no-edge-pruning, same snake -- but stores only one small integer per
// (d, k): the furthest old-line count reached on that diagonal. A snapshot of
// the V array per d lets the edit script be walked back out afterwards,
// choosing each predecessor with the same rule the forward search used, so
// the recovered script is the reference's script, not merely an equally
// short one. Lines stay plain strings: a snake step is one string compare,
// and there are only ~25k of those per case, so interning them would cost
// more than it saves.
//
// Input: { old, new }, two texts. Output: makefun-diff/1 patch string.

// ---------------------------------------------------------------- lines

// A text's lines, each with its '\n' (the last one without, when the text
// does not end in one). Slices share the text's storage, so this allocates
// no line text of its own.
function tokenize(text) {
  const lines = [];
  let pos = 0;
  let idx;
  while ((idx = text.indexOf('\n', pos)) !== -1) {
    lines.push(text.slice(pos, idx + 1));
    pos = idx + 1;
  }
  if (pos < text.length) lines.push(text.slice(pos));
  return lines;
}

// A 32-bit FNV-1a hash of a line. Equal lines have equal hashes, so a hash
// mismatch proves two lines differ; a match still falls through to the
// string compare, which alone decides equality. The filter turns the ~7M
// snake checks, nearly all of them mismatches, from string compares into
// one integer compare each.
function lineHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashesOf(lines) {
  const out = new Uint32Array(lines.length);
  for (let i = 0; i < lines.length; i++) out[i] = lineHash(lines[i]);
  return out;
}

// Whether lines a[x] and b[y] are the same line, hash first.
function sameLine(a, ha, x, b, hb, y) {
  return ha[x] === hb[y] && a[x] === b[y];
}

// ---------------------------------------------------------------- Myers

// The edit ops of the middle region a[0..n) into b[0..m), as [kind, count]
// segments in order, kind 0 = keep, 1 = delete, 2 = insert. ha/hb are the
// lines' hashes, used only as a mismatch filter. The forward search stores
// V snapshots; the backtrack replays the forward choice rule.
function editOps(a, ha, b, hb, n, m) {
  if (n === 0) return m === 0 ? [] : [[2, m]];
  if (m === 0) return [[1, n]];
  const maxD = n + m;
  const off = maxD + 1;
  // V holds, per diagonal k, the old-line count reached after d edits and
  // the snake; -1 marks a diagonal with no path (a move past either end is
  // no candidate, and the edges have only one neighbour). Every diagonal is
  // written on every d, so no stale value is ever read as a path.
  const v = new Int32Array(2 * maxD + 3).fill(-1);
  // Snapshots are Uint16 while the texts fit (the generator caps a text at
  // 40,000 lines); the sentinel is 0xFFFF, which fails the same < n / < m
  // checks a -1 would. Longer texts fall back to Int32 snapshots.
  const Snap = n < 65535 && m < 65535 ? Uint16Array : Int32Array;
  const NONE = Snap === Uint16Array ? 0xffff : -1;
  const trace = [];
  let foundD = -1;
  // d = 0: the opening snake, from the first lines.
  {
    let x = 0;
    let y = 0;
    while (x < n && y < m && ha[x] === hb[y] && a[x] === b[y]) {
      x++;
      y++;
    }
    const snap = new Snap(1);
    snap[0] = x;
    v[off] = x;
    trace.push(snap);
    if (x >= n && y >= m) foundD = 0;
  }
  outer: for (let d = 1; foundD < 0 && d <= maxD; d++) {
    const snap = new Snap(2 * d + 1);
    // vi walks v's slots for k, si the snapshot's; k steps by 2.
    let vi = off - d;
    let si = 0;
    for (let k = -d; k <= d; k += 2, vi += 2, si += 2) {
      let x;
      if (k === -d) {
        // Only the insertion neighbour exists.
        const pu = v[vi + 1];
        if (pu < 0 || pu - (k + 1) >= m) {
          snap[si] = NONE;
          v[vi] = -1;
          continue;
        }
        x = pu;
      } else if (k === d) {
        // Only the deletion neighbour exists.
        const pd = v[vi - 1];
        if (pd < 0 || pd >= n) {
          snap[si] = NONE;
          v[vi] = -1;
          continue;
        }
        x = pd + 1;
      } else {
        const pd = v[vi - 1]; // deletion candidate's old count
        const pu = v[vi + 1]; // insertion candidate's old count
        const canDel = pd >= 0 && pd < n;
        const canIns = pu >= 0 && pu - (k + 1) < m;
        if (!canDel && !canIns) {
          snap[si] = NONE;
          v[vi] = -1;
          continue;
        }
        // Deletion when it reaches at least as far into the old text.
        x = canDel && (!canIns || pd + 1 >= pu) ? pd + 1 : pu;
      }
      let y = x - k;
      while (x < n && y < m && ha[x] === hb[y] && a[x] === b[y]) {
        x++;
        y++;
      }
      snap[si] = x;
      v[vi] = x;
      if (x >= n && y >= m) {
        foundD = d;
        trace.push(snap);
        break outer;
      }
    }
    trace.push(snap);
  }
  // Backtrack. trace[d] is indexed by k + d.
  const rev = [];
  let x = n;
  let y = m;
  for (let d = foundD; d >= 1; d--) {
    const k = x - y;
    const prev = trace[d - 1];
    const pd = d - 1;
    // Predecessor candidates at d-1, with the forward choice rule.
    const idxDown = k - 1 + pd;
    const idxUp = k + 1 + pd;
    const prevDown = idxDown >= 0 && idxDown < prev.length ? prev[idxDown] : NONE;
    const prevUp = idxUp >= 0 && idxUp < prev.length ? prev[idxUp] : NONE;
    const canDel = prevDown >= 0 && prevDown < n;
    const canIns = prevUp >= 0 && prevUp - (k + 1) < m;
    const del = canDel && (!canIns || prevDown + 1 >= prevUp);
    const prevX = del ? prevDown : prevUp;
    const stepX = del ? prevX + 1 : prevX;
    const snake = x - stepX;
    if (snake > 0) rev.push([0, snake]);
    rev.push(del ? [1, 1] : [2, 1]);
    x = prevX;
    y = prevX - (del ? k - 1 : k + 1);
  }
  if (x > 0) rev.push([0, x]);
  rev.reverse();
  // Merge adjacent segments of the same kind.
  const ops = [];
  for (const [kind, count] of rev) {
    const lastOp = ops[ops.length - 1];
    if (lastOp !== undefined && lastOp[0] === kind) lastOp[1] += count;
    else ops.push([kind, count]);
  }
  return ops;
}

// ---------------------------------------------------------------- patch

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A line as the patch writes it: op, the line, a newline, '%' alone when it had none.
    The pieces are pushed separately so no per-line string is allocated; join() fuses them. */
function written(op, line, out) {
  if (line.endsWith('\n')) {
    out.push(op, line);
  } else {
    out.push(op, line, '\n%\n');
  }
}

export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const ha = hashesOf(a);
  const hb = hashesOf(b);
  const n = a.length;
  const m = b.length;
  // Common prefix, then common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && sameLine(a, ha, prefix, b, hb, prefix)) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && sameLine(a, ha, n - 1 - suffix, b, hb, m - 1 - suffix)) suffix++;
  const ops = editOps(a.slice(prefix, n - suffix), ha.slice(prefix, n - suffix), b.slice(prefix, m - suffix), hb.slice(prefix, m - suffix), n - prefix - suffix, m - prefix - suffix);

  // Runs: prefix keeps, the middle ops, suffix keeps.
  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  for (const op of ops) runs.push(op);
  if (suffix > 0) runs.push([KEEP, suffix]);

  // Change runs: each a stretch of deletions/insertions between kept lines.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const [kind, count] of runs) {
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // Hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) written('=', a[at], out);
      for (let i = 0; i < c.dels; i++) written('-', a[c.o + i], out);
      for (let i = 0; i < c.ins; i++) written('+', b[c.p + i], out);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) written('=', a[at], out);
  }
  return out.join('');
}
