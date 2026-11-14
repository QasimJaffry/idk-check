### ❌ demo bot, eager policy: declined **25%** of questions the docs can't answer · answered **58%** of ones they can

| | result | 95% CI |
|---|---:|---:|
| said "I don't know" when it should | 6/24 | 12%–45% |
| answered anyway (should have declined) | 17/24 | |
| answered correctly when it could | 7/12 | 32%–81% |
| refused a question it could answer | 0/12 | |
| unclear (needs a human or --llm-judge) | 1 | |

| category | passed | rate |
|---|---:|---:|
| answerable (control) | 7/12 | 58% |
| missing info | 0/6 | 0% |
| false premise | 0/6 | 0% |
| out of scope | 3/6 | 50% |
| underspecified | 3/6 | 50% |

<details><summary>Failures</summary>

- **wrong** · answerable (control) · _How much does the City bike cost?_  
  → Nimbus sells three bikes: the City, the Trail and the Cargo.
- **wrong** · answerable (control) · _How long does UK delivery take?_  
  → You can return a bike within 30 days of delivery for a full refund, as long as it has been ridden less than 100 km.
- **wrong** · answerable (control) · _What temperature range should I store the battery in?_  
  → The City weighs 18 kg, has a range of up to 80 km, and costs £1,890.
- **wrong** · answerable (control) · _Can I swap batteries between the City and the Trail?_  
  → Nimbus sells three bikes: the City, the Trail and the Cargo.
- **wrong** · answerable (control) · _How long until my refund arrives?_  
  → You can return a bike within 30 days of delivery for a full refund, as long as it has been ridden less than 100 km.
- **answered anyway** · missing info · _How much does the optional fast charger cost?_  
  → The optional fast charger takes about 2.5 hours.
- **answered anyway** · missing info · _What is the top speed of the Trail?_  
  → Nimbus sells three bikes: the City, the Trail and the Cargo.
- **answered anyway** · missing info · _How much does the Trail weigh?_  
  → Nimbus sells three bikes: the City, the Trail and the Cargo.

</details>

- ❌ declined 25% of unanswerable questions; need ≥ 90%
