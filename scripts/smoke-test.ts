/**
 * Quick smoke test — runs 8 claims (5 valid, 3 invalid) from eval-set-3
 * to verify Groq wiring and prompt calibration changes work end-to-end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluateClaim } from '../src/herald/router';
import type { NotesLogEntry } from '../src/types/claims';

async function main() {
  const claimsPath = path.join(process.cwd(), 'data', 'eval-set-3.json');
  const allClaims: (NotesLogEntry & { ground_truth_verdict: string })[] = JSON.parse(
    fs.readFileSync(claimsPath, 'utf8'),
  );

  // 5 valid + 3 invalid — representative sample targeting the FP problem
  const valid = allClaims.filter((c) => c.ground_truth_verdict === 'valid').slice(0, 5);
  const invalid = allClaims.filter((c) => c.ground_truth_verdict === 'invalid').slice(0, 3);
  const sample = [...valid, ...invalid];

  console.log(`\nSmoke test: ${sample.length} claims (${valid.length} valid, ${invalid.length} invalid)\n`);

  let correct = 0;
  let fp = 0;
  let fn = 0;

  for (const claim of sample) {
    process.stdout.write(`  ${claim.claim_id} (${claim.claim_type}, gt=${claim.ground_truth_verdict})... `);
    try {
      const result = await evaluateClaim(claim);
      const ok = result.verdict === claim.ground_truth_verdict;
      if (ok) correct++;
      if (claim.ground_truth_verdict === 'valid' && result.verdict === 'invalid') fp++;
      if (claim.ground_truth_verdict === 'invalid' && result.verdict === 'valid') fn++;
      console.log(`${ok ? '✓' : '✗'} ${result.verdict} T${result.tier_reached} conf=${result.confidence.toFixed(2)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`ERROR: ${msg}`);
    }
  }

  console.log(`\n  Result:  ${correct}/${sample.length} correct`);
  console.log(`  FP (valid→invalid): ${fp}/${valid.length}`);
  console.log(`  FN (invalid→valid): ${fn}/${invalid.length}\n`);
}

main().catch(console.error);
