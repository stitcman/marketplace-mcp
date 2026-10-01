import assert from 'node:assert/strict';
import {reconcilePostingDay} from '../docs/audits/2026-10-01-ozon-api-refresh/final-contract-finance/finance-reconcile.mjs';
assert.throws(()=>reconcilePostingDay([{unit_number:'p',date:'2026-09-30',total_amount:{amount:'1',currency:'RUB'}}],[],'2026-09-30'),/MISSING_POSTING/);
const day=[{unit_number:'p',date:'2026-09-30',total_amount:{amount:'1.25',currency:'RUB'}}];
assert.equal(reconcilePostingDay(day,[{posting_number:'p',accruals:[{accrual_date:'2026-09-30',accrued:{amount:'1.25',currency:'RUB'}},{accrual_date:'2026-09-29',accrued:{amount:'8',currency:'RUB'}}]}],'2026-09-30').status,'PASS');
assert.equal(reconcilePostingDay(day,[{posting_number:'p',accruals:[{accrual_date:'2026-09-30',accrued:{amount:'2',currency:'RUB'}}]}],'2026-09-30').status,'FAIL');
console.log('PASS cross-endpoint reconciliation rejects empty coverage and distinguishes all-date history');
