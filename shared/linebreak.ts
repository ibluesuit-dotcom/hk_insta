// Width comes from the actual loaded Pretendard DOM at each candidate font size.
export function candidateLines(
  text: string,
  width: (s: string) => number,
  max = 952,
  onSemanticPenalty?: (penalty: number) => void,
): string[] {
  const words = text.trim().split(/\s+/);
  const groups: string[] = [];
  const number =
    /^[\d,.]+(?:[조억천백만]+)?(?:원|달러|유로|엔|%p?|명|개|배|월|년|일|톤|kg)?$/;
  const unit = /^(원|달러|유로|엔|프랑|명|개|배|톤|kg|%p?)$/;
  const orphan =
    /^(?:[.,!?;:…，。！？)\]}'"”’]+|은|는|이|가|을|를|의|에|와|과|도|로|으로|에서|부터|까지)$/;
  for (let i = 0; i < words.length; i++) {
    let group = words[i];
    if (number.test(group)) {
      while (
        i + 1 < words.length &&
        (number.test(words[i + 1]) || unit.test(words[i + 1]))
      )
        group += " " + words[++i];
    } else if (
      /^(스위스|미국|일본|중국|홍콩|호주|캐나다)$/.test(group) &&
      /^(프랑|달러|엔|위안)$/.test(words[i + 1] || "")
    )
      group += " " + words[++i];
    if (orphan.test(group) && groups.length)
      groups[groups.length - 1] += " " + group;
    else groups.push(group);
  }
  // Rank linguistic boundaries before line-length balance. This is deliberately
  // deterministic: never rewrite the title or ask an AI to shorten it.
  const normalized = groups.join(" ");
  const quotes = [
    ...normalized.matchAll(
      /“[^”]*”|‘[^’]*’|"[^"\n]*"|(?:^|\s)'[^'\n]+'(?=\s|$|[,!?])/g,
    ),
  ].map((match) => [match.index!, match.index! + match[0].length]);
  let offset = 0;
  const boundary = groups.map((left, index) => {
    offset += left.length;
    const insideQuote = quotes.some(
      ([start, end]) => start < offset && offset < end,
    );
    const right = groups[index + 1] || "";
    const last = left.split(/\s+/).at(-1)!;
    const first = right.split(/\s+/)[0];
    offset++;
    const predicate =
      /^(?:급락|급등|하락|상승|돌파|증가|감소|증발|상향|하향|전환|동결|인하|인상|기록|경신|마감)$/;
    let cost = 1;
    // Completed quotations/sentences/clauses are natural places to breathe.
    if (
      /[”’"'!?。…,:，.]$/.test(last) ||
      predicate.test(last) ||
      /(?:지만|는데|으며|면서|다면|으면|거나|했다|된다|한다|있다|없다|될까|일까|있나|없나|인가|합니다|습니다)$/.test(
        last,
      )
    )
      cost = 0;
    else if (/(?:은|는|에서|으로|까지|부터|보다)$/.test(last)) cost = 0.3;
    // Keep modifiers, dependent nouns, auxiliary predicates and price phrases
    // attached. Prefer a phrase boundary inside an overlong quotation.
    if (
      /(?:의|적인|대한|위한|따른)$/.test(last) ||
      /^(?:계속|진짜|정말|매우|더|덜|못|안|잘|새|총|약|사상|최대|최소)$/.test(
        last,
      )
    )
      cost += 5;
    if (
      /^(?:수|것|때|데|바|줄|뿐|중)(?:은|는|이|가|을|를|도|에)?$/.test(first) ||
      /^(?:수|것|때|데|바|줄)$/.test(last)
    )
      cost += 7;
    if (
      /^(?:목표가|목표주가|매출|매출액|영업이익|순이익|시가총액)(?:는|은|이|가)?$/.test(
        first,
      ) &&
      !predicate.test(last) &&
      !/[\d]|[”’"'!?。…,:，.]$/.test(last)
    )
      cost += 2;
    if (
      /^(?:목표가|목표주가|매출|매출액|영업이익|순이익|시가총액)(?:는|은|이|가)?$/.test(
        last,
      ) &&
      /^[\d,.]/.test(first)
    )
      cost += 7;
    if (
      predicate.test(first) &&
      (/[\d]/.test(left) || /(?:으로|로)$/.test(last))
    )
      cost += 8;
    if (insideQuote) cost += 5;
    return cost;
  });
  const measured = new Map<string, number>();
  const measure = (line: string) => {
    if (!measured.has(line)) measured.set(line, width(line));
    return measured.get(line)!;
  };
  let best: string[] = [],
    score = Infinity,
    bestSemantic = Infinity;
  function visit(start: number, lines: string[], semantic: number) {
    if (start === groups.length) {
      const widths = lines.map(measure),
        mean = widths.reduce((a, b) => a + b, 0) / widths.length;
      const ragged = widths.reduce(
        (sum, w) => sum + ((w - mean) / max) ** 2,
        0,
      );
      const shortLast = widths.at(-1)! < mean * 0.45 ? 2 : 0;
      // A short isolated token is usually a dangling subject or predicate,
      // not a meaningful phrase. Keep it possible only as a last resort.
      const isolated =
        lines.length > 1
          ? lines.filter((line, i) => !/\s/.test(line) && widths[i] < max * 0.4)
              .length * 8
          : 0;
      const meaning = semantic + isolated;
      const cost = meaning * 10 + lines.length * 0.18 + ragged + shortLast;
      if (cost < score) {
        score = cost;
        bestSemantic = meaning;
        best = lines;
      }
      return;
    }
    if (lines.length === 3) return;
    for (let end = start + 1; end <= groups.length; end++) {
      const line = groups.slice(start, end).join(" ");
      if (measure(line) > max) break;
      if (orphan.test(line)) continue;
      visit(
        end,
        [...lines, line],
        semantic + (end < groups.length ? boundary[end - 1] : 0),
      );
    }
  }
  visit(0, [], 0);
  onSemanticPenalty?.(bestSemantic);
  return best;
}
