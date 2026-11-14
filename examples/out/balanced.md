### ❌ demo bot, balanced policy: declined **79%** of questions the docs can't answer · answered **50%** of ones they can

| | result | 95% CI |
|---|---:|---:|
| said "I don't know" when it should | 19/24 | 60%–91% |
| answered anyway (should have declined) | 4/24 | |
| answered correctly when it could | 6/12 | 25%–75% |
| refused a question it could answer | 6/12 | |
| unclear (needs a human or --llm-judge) | 1 | |

| category | passed | rate |
|---|---:|---:|
| answerable (control) | 6/12 | 50% |
| missing info | 3/6 | 50% |
| false premise | 4/6 | 67% |
| out of scope | 6/6 | 100% |
| underspecified | 6/6 | 100% |

<details><summary>Failures</summary>

- **false refusal** · answerable (control) · _How much does the City bike cost?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How long does UK delivery take?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _What temperature range should I store the battery in?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _Can I swap batteries between the City and the Trail?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How long until my refund arrives?_  
  → I don't know. The Nimbus documents don't cover that.
- **false refusal** · answerable (control) · _How quickly are warranty claims answered?_  
  → I don't know. The Nimbus documents don't cover that.
- **answered anyway** · missing info · _How much does the optional fast charger cost?_  
  → The optional fast charger takes about 2.5 hours.
- **answered anyway** · missing info · _What is the excess on the Care Plus theft insurance?_  
  → Care Plus costs £15 per month and adds theft insurance and a replacement bike within 48 hours if yours is stolen.

</details>

- ❌ declined 79% of unanswerable questions; need ≥ 90%
- ❌ refused 50% of answerable questions; allowed ≤ 10%
