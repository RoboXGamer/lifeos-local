# LifeOS structured capture: model test

Copy everything below the line into the model you want to test. The examples teach the format; the 12 captures at the end are the actual test. Return the results for all 12 in one response.

---

You convert personal captures into structured LifeOS data. Interpret English, Hindi and Hinglish. For each capture, return a separate result under its ID.

**Reference date and time zone:** Monday, 2026-11-02, Asia/Kolkata. Interpret “Friday” as the coming Friday, 2026-11-06. Do not use today's actual date.

Rules:

1. Extract only facts explicitly stated in the current capture. Do not take facts from the examples or other captures.
2. `tasks` are actions the user intends to perform. Another person's promise belongs in `waiting`, not the user's tasks.
3. Use one money record per distinct monetary fact. A `quote` is not an `agreed` amount; `planned` is not `paid`. A refund has state `refund`.
4. If the capture says a deal is not final or payment has not happened, do not create an agreement or a completed payment.
5. Convert Indian number expressions into numeric amounts: one lakh = 100000; one hazaar = 1000.
6. Use `INR` only when the current capture explicitly includes ₹, Rs, rupees or rupaye. Otherwise use `null`.
7. If an amount, person or date is not stated, use `null`. Dates must be in `YYYY-MM-DD` format. Do not invent dates or people.
8. If there are no tasks, money records or waiting items, use empty arrays. Use `uncertainties` for important unresolved ambiguity.

Return **only valid JSON** with this structure. Include all fields for every entry:

```json
{
  "results": [
    {
      "id": "case_id",
      "tasks": [
        {"action": "string", "person": "string or null", "scheduled_date": "YYYY-MM-DD or null"}
      ],
      "money": [
        {"person": "string or null", "description": "string or null", "amount": "number or null", "currency": "string or null", "state": "quote | agreed | planned | paid | refund | unknown"}
      ],
      "waiting": [
        {"person": "string or null", "action": "string", "scheduled_date": "YYYY-MM-DD or null"}
      ],
      "uncertainties": ["string"]
    }
  ]
}
```

In actual output, `amount` must be a JSON number or `null`, not a string.

Examples:

**Input:** Priya ne decoration ka ₹25,000 quote diya. Friday ko Priya ko call karna hai.

```json
{"tasks":[{"action":"call","person":"Priya","scheduled_date":"2026-11-06"}],"money":[{"person":"Priya","description":"decoration","amount":25000,"currency":"INR","state":"quote"}],"waiting":[],"uncertainties":[]}
```

**Input:** Deepa 60 hazaar par maan gayi. Maine usko 10 hazaar advance de diya.

```json
{"tasks":[],"money":[{"person":"Deepa","description":null,"amount":60000,"currency":null,"state":"agreed"},{"person":"Deepa","description":"advance","amount":10000,"currency":null,"state":"paid"}],"waiting":[],"uncertainties":[]}
```

**Input:** Tara ne mujhe promise kiya ki woh Friday ko report bhejegi.

```json
{"tasks":[],"money":[],"waiting":[{"person":"Tara","action":"send report","scheduled_date":"2026-11-06"}],"uncertainties":[]}
```

**Input:** Kabir ne ₹40,000 quote diya; rate final nahi hua, aur payment abhi nahi hui.

```json
{"tasks":[],"money":[{"person":"Kabir","description":null,"amount":40000,"currency":"INR","state":"quote"}],"waiting":[],"uncertainties":[]}
```

**Input:** Vikram ne ₹3,000 refund kar diye.

```json
{"tasks":[],"money":[{"person":"Vikram","description":null,"amount":3000,"currency":"INR","state":"refund"}],"waiting":[],"uncertainties":[]}
```

**Input:** Garden mein white flowers achhe lagenge. Koi kaam nahi karna.

```json
{"tasks":[],"money":[],"waiting":[],"uncertainties":[]}
```

**Input:** Priya se ₹2 lakh ki sale confirm hai; Arjun ne ₹30,000 ka quote diya.

```json
{"tasks":[],"money":[{"person":"Priya","description":"sale","amount":200000,"currency":"INR","state":"agreed"},{"person":"Arjun","description":null,"amount":30000,"currency":"INR","state":"quote"}],"waiting":[],"uncertainties":[]}
```

**Input:** Divya ko call karna hai.

```json
{"tasks":[{"action":"call","person":"Divya","scheduled_date":null}],"money":[],"waiting":[],"uncertainties":[]}
```

**Input:** Agale mahine supplier ko ₹7,000 dene hain, abhi payment nahi ki.

```json
{"tasks":[],"money":[{"person":null,"description":null,"amount":7000,"currency":"INR","state":"planned"}],"waiting":[],"uncertainties":[]}
```

Now process these **12 test captures**, independently:

1. `new_quote_task`: Zoya ne lighting ke liye ₹3 lakh quote diya; Friday ko Zoya ko call karunga.
2. `new_paid_no_currency`: Arjun ko maine pachaas hazaar de diye.
3. `new_quote_not_paid`: Simran ka ₹35,000 quote hai, payment abhi nahi hui aur deal confirm nahi hai.
4. `new_two_people`: Pooja se ₹6 lakh ki sale confirm hai. Karan ne venue ke liye ₹2 lakh ka quote diya.
5. `new_future_unpaid`: Agle mahine plumber ko ₹8,000 dene hain; abhi tak paise nahi diye.
6. `new_refund`: Decorator Anil ne mujhe ₹4,000 refund kar diye.
7. `new_other_waiting`: Leena ne kaha woh Friday ko mujhe contract bhejegi; main uska wait kar raha hoon.
8. `new_neutral`: Mujhe lagta hai samundar ki hawa bahut achhi hoti hai.
9. `new_task_no_date`: Mujhe Farah se meeting ke baare mein baat karni hai.
10. `new_received_unknown_total`: Customer se ₹45,000 mil gaye; final agreed price mujhe pata nahi hai.
11. `new_hindi_payment`: मैंने रवि को ₹9000 का अग्रिम भुगतान कर दिया।
12. `new_no_amount`: Nikhil ne price confirm kiya hai par amount abhi mujhe nahi bataya.

Return one JSON object with a `results` array containing exactly one entry for each ID, in the same order. Do not include the example inputs in the results.
