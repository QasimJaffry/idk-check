### ❌ demo bot, strict policy: declined **96%** of questions the docs can't answer · answered **33%** of ones they can

| | result | 95% CI |
|---|---:|---:|
| said "I don't know" when it should | 23/24 | 80%–99% |
| answered anyway (should have declined) | 1/24 | |
| answered correctly when it could | 4/12 | 14%–61% |
| refused a question it could answer | 8/12 | |

| category | passed | rate |
|---|---:|---:|
| answerable (control) | 4/12 | 33% |
| missing info | 5/6 | 83% |
| false premise | 6/6 | 100% |
| out of scope | 6/6 | 100% |
| underspecified | 6/6 | 100% |

<details><summary>Failures</summary>

- **false refusal** · answerable (control) · _How much does the City bike cost?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How much weight can the Cargo carry?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How long does UK delivery take?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How much does return shipping cost outside the UK?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _What temperature range should I store the battery in?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _Can I swap batteries between the City and the Trail?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How long until my refund arrives?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How quickly are warranty claims answered?_  
  → I don't know. The Nimbus documents don't cover that.

</details>

- ❌ refused 67% of answerable questions; allowed ≤ 10%
