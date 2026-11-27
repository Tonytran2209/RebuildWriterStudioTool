# Page type outlines – F.Learning (T1–T4)

```outline-structures
{
  "version": 1,
  "structures": [
    {
      "id": "fl-t1-pillar-guide",
      "name": "T1 Pillar Guide (Tổng hợp)",
      "description": "Complete guide to a topic: what it is, why use it, cost, types with examples, how to choose, what to settle before buying. Hub page linking down to toplists and comparisons. Model: 'Medical Animation: A Complete Guide with 10 Examples in 2026'. Target about 3,000 words.",
      "useWhen": "The primary query is the topic itself or 'what is / guide / examples / types of [X]' and the intent is informational.",
      "outlineInstructions": "PURPOSE: the reader sees the whole picture (what X is, what it is used for, types, cost, pitfalls) and can decide. The N in the H1 equals the number of H3 examples under 'Types of [X]'.\n\nH1: '[X]: A Complete Guide with [N] Examples in [Year]'.\nLede (word range and paragraph count from Gate Settings): bold defining sentence; a POV sentence; roadmap in H2 order.\n\nSECTIONS IN ORDER:\n1. H2 'What Makes [an X] \"[X]\"' (~250w): a concrete image of how real X differs from the ordinary version; '[Number] requirements separate [X] from [ordinary]:' as labelled bullets; closing sentence; link: service page. No H3.\n2. H2 '[N] Reasons Why You Should Use [X]' (~400w): lead-in on the contexts X is used in.\n   - H3 '1. [Benefit in context A]' ... H3 '3. [Benefit in context C]' (~120w each, link: use-case page). The H2's last H3 ends with one bold sentence on the financial reason.\n3. H2 'How Much Does [X] Cost?' (~150w): studio vs freelancer ranges only if Domain Knowledge has them (otherwise the cost drivers), F's price position and why (R-F3); link: cost page. No H3.\n4. H2 'Types of [X] with [N] Examples' (~1,100w): one lead-in sentence.\n   - H3 '1. [Type / application]' ... H3 '[N]. ...' (~110w each, micro-template EX). Examples span several audiences and techniques.\n5. H2 '[A] or [B]: Which One Your Project Actually Needs' (~220w): the real deciding criterion; [TABLE: Choose | When the subject is | Typical use | Watch out for] with rows A, B, both; then 'The common mistake is... The opposite mistake is...'. No H3.\n6. H2 '[M] Things To Settle Before You Commission [X]' (~600w): lead-in: projects slip because of decisions made before production.\n   - H3 '1. [Factor]' ... H3 '[M]. [Factor]' (~85w each, micro-template CK).\n7. H2 'Why F.Learning Is a Good Choice for [X]' (~300w):\n   - H3 '1. [Value + reason for the advantage]' (link: process page)\n   - H3 '2. [Experience + clients + rating]'\n   - H3 '3. [Breadth of expertise, with the honest limit]'\n8. H2 'FAQs About [X]' (~350w), last section:\n   - H3 'What Is [X]?' · H3 'Should I Choose [A] or [B] [X]?' · H3 'How Much Does [X] Cost?' · H3 [who reviews / process question] · H3 [regulation / risk question] · H3 'Where Can [X] Be Used?'\n\nMICRO-TEMPLATE EX (each example):\n- **Type:** technique (+ link to the technique page if in the inventory, within the one-link limit)\n- **Description:** what the example video does\n- **Purpose:** what it is for, for whom\n- **Best for:** F's opinion on when it is worth the money and when it is not (not a repeat of Description)\n\nMICRO-TEMPLATE CK (each thing to settle): the factor -> why it breaks the project -> who owns it and at which stage -> the cost of settling it late.\n\nSECTION COUNT: about 30-36 sections (H2 + H3).\n\nGENERAL (all page types):\n- Headings are reader-ready English in Title Case. Replace [X], [Y], [N], [Year] with real values; keep the structure and order below.\n- Only H2 and H3. Never H4. Sub-blocks inside an H3 (proofs, case study) are labelled bullets or bold lead-in labels in that section's notes, not headings.\n- The outline contains body sections only. Never add a closing section to the outline. The platform appends exactly one closing H2 to the final draft, using Gate Settings conclusionHeading (recommended: 'Where to Start'). That final draft heading is permitted outside the outline. The FAQ H2 is the last section of the outline.\n- Count H2 and H3 together as sections; this layout needs the section count given below even when a generic prompt suggests fewer.\n- In each section's notes: the main points, required blocks ([TABLE: columns], CTA), which Article Spec items it delivers (questions, contentGaps, informationGain, citationTargets, brandAssets), the internal link target type if any (at most one per section), and an optional 'Image idea: ...' for the editor.\n- Facts not in Domain Knowledge are never planned as content; write 'Owner to confirm: ...' in the notes instead.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "draftInstructions": "- 'Best for' lines carry a clear opinion; never repeat the Description.\n- The cost section stays short. The decision table is mandatory.\n- The F section comes after all neutral content and before the FAQ.\n\nGENERAL (all page types):\n- Section content is prose, Markdown tables and labelled bullets ('- **Label:** content'). Never write a heading inside a section and never an image marker, image URL or placeholder such as [CẦN XÁC NHẬN] or [TBD].\n- First sentence of every section: a short, quotable claim. Paragraphs of 2-4 sentences.\n- An H2 that has H3 children gets 1-3 lead-in sentences only.\n- Every table is followed by 1-2 sentences that interpret it ('The common mistake is...').\n- At most one internal link per section, only from the approved Website Inventory list, with a descriptive anchor.\n- The closing (appended automatically, heading and word budget from Gate Settings): give a concrete next step, then verified contact details only when supplied in the approved evidence. Never invent contact details.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "requiredHeadings": [
        {
          "heading": "What Makes [an X] \"[X]\"",
          "level": "h2"
        },
        {
          "heading": "[N] Reasons Why You Should Use [X]",
          "level": "h2"
        },
        {
          "heading": "How Much Does [X] Cost?",
          "level": "h2"
        },
        {
          "heading": "Types of [X] with [N] Examples",
          "level": "h2"
        },
        {
          "heading": "[A] or [B]: Which One Your Project Actually Needs",
          "level": "h2"
        },
        {
          "heading": "[M] Things To Settle Before You Commission [X]",
          "level": "h2"
        },
        {
          "heading": "Why F.Learning Is a Good Choice for [X]",
          "level": "h2"
        },
        {
          "heading": "FAQs About [X]",
          "level": "h2"
        }
      ]
    },
    {
      "id": "fl-t2-company-toplist",
      "name": "T2 Company Toplist (Companies Compared)",
      "description": "Compares N companies so the reader can shortlist 2-3. F.Learning is item 1 with a disclosure. Model: '10 Medical Animation Companies Compared (2026)'. Target about 2,300 words.",
      "useWhen": "The primary query is '[X] companies', 'best [X] studios' or 'top [X] agencies' and the reader already intends to hire a studio.",
      "outlineInstructions": "PURPOSE: the reader leaves with a shortlist of 2-3 companies that fit their need.\n\nH1: '[N] [X] Companies Compared ([Year])'.\nLede (word range and paragraph count from Gate Settings): bold sentence naming the leading companies and F's position, then 'The right choice depends on...'; paragraph 2 = roadmap, a link to a sibling toplist if in the inventory, and the italic disclosure as its last sentence.\n\nSECTIONS IN ORDER:\n1. H2 '[N] [X] Companies at a Glance' (~250w): [TABLE: Company | Based in | Known for | Main formats | Best fit if you need] with N rows. No H3.\n2. H2 '1. F.Learning' (~330w): position, since-year, notable clients, real strength and the honest limit (R-F4); link: service page.\n   - H3 '[Proof 1: domain expertise]' (case study from the fact sheet)\n   - H3 '[Proof 2: value / budget]' (case-study figure from the fact sheet)\n   - H3 '[Proof 3: large projects / process]' (link: process page); ends with an inline CTA such as 'Judge the output rather than the claim: browse our ... work'.\n3. H2 '2. [Competitor]' ... H2 '[N]. [Competitor]' (~90w each, micro-template CO, data only from Competitor profiles). No H3.\n4. H2 'How to Choose the Right [X] Company' (~330w):\n   - H3 '1. Match the Format to Your Subject' (refers back to the 'Best fit' column)\n   - H3 '2. Examine Experience and [Domain] Expertise'\n   - H3 '3. Check Professionalism and Review Process' (concrete questions to ask a studio)\n   - H3 '4. Evaluate Technical Proficiency'\n   - H3 '5. Analyse Cost and Value' (ranges only if in Domain Knowledge; link: cost page)\n5. H2 'FAQs About [X] Companies' (~280w), last section:\n   - H3 'Which [X] Company Is Best?' (match each need to a company; F only to needs F is strong at) · H3 'What Does [an X] Company Do?' · H3 'How Much Do [X] Companies Charge?' · H3 [free resources / alternatives question] · H3 'How Long Does [an X] Project Take?'\n\nMICRO-TEMPLATE CO (each competitor, as the section content):\none ~50-word paragraph (who they are, founding year, strongest area, from public sources), then\n- **Website:** domain\n- **Based in:** city, country\n- **Specialties:** ...\n- **Named clients:** only if public\n- **Recognition:** only if any\n- **Best fit for:** distinct for each company\n\nSECTION COUNT: about 22-26 sections (H2 + H3).\n\nGENERAL (all page types):\n- Headings are reader-ready English in Title Case. Replace [X], [Y], [N], [Year] with real values; keep the structure and order below.\n- Only H2 and H3. Never H4. Sub-blocks inside an H3 (proofs, case study) are labelled bullets or bold lead-in labels in that section's notes, not headings.\n- The outline contains body sections only. Never add a closing section to the outline. The platform appends exactly one closing H2 to the final draft, using Gate Settings conclusionHeading (recommended: 'Where to Start'). That final draft heading is permitted outside the outline. The FAQ H2 is the last section of the outline.\n- Count H2 and H3 together as sections; this layout needs the section count given below even when a generic prompt suggests fewer.\n- In each section's notes: the main points, required blocks ([TABLE: columns], CTA), which Article Spec items it delivers (questions, contentGaps, informationGain, citationTargets, brandAssets), the internal link target type if any (at most one per section), and an optional 'Image idea: ...' for the editor.\n- Facts not in Domain Knowledge are never planned as content; write 'Owner to confirm: ...' in the notes instead.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "draftInstructions": "- Each company is one H2. F's proofs are H3 under F's H2.\n- The 'Best fit' column in the table matches each company's 'Best fit for' line word for word in meaning.\n- Competitor statements are attributed and neutral; never rank them as better or worse.\n- The automatically appended closing gives the 3-step process (what to show and to whom -> shortlist 2-3 -> ask them the same questions) and when to call F.\n\nGENERAL (all page types):\n- Section content is prose, Markdown tables and labelled bullets ('- **Label:** content'). Never write a heading inside a section and never an image marker, image URL or placeholder such as [CẦN XÁC NHẬN] or [TBD].\n- First sentence of every section: a short, quotable claim. Paragraphs of 2-4 sentences.\n- An H2 that has H3 children gets 1-3 lead-in sentences only.\n- Every table is followed by 1-2 sentences that interpret it ('The common mistake is...').\n- At most one internal link per section, only from the approved Website Inventory list, with a descriptive anchor.\n- The closing (appended automatically, heading and word budget from Gate Settings): give a concrete next step, then verified contact details only when supplied in the approved evidence. Never invent contact details.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "requiredHeadings": [
        {
          "heading": "[N] [X] Companies at a Glance",
          "level": "h2"
        },
        {
          "heading": "1. F.Learning",
          "level": "h2"
        },
        {
          "heading": "How to Choose the Right [X] Company",
          "level": "h2"
        },
        {
          "heading": "FAQs About [X] Companies",
          "level": "h2"
        }
      ]
    },
    {
      "id": "fl-t3-comparison",
      "name": "T3 Comparison (X vs Y)",
      "description": "Gives a verdict and a framework to choose between two options. Model: '2D vs 3D Animation: Discovering 10 Key Differences'. Target about 3,000 words.",
      "useWhen": "The primary query is 'X vs Y', 'X or Y', 'difference between X and Y' or 'is X better than Y'.",
      "outlineInstructions": "PURPOSE: a verdict and a way for the reader to choose between X and Y. Always X before Y. The N in the H1 equals the rows of the differences table and the number of difference H3s.\n\nH1: '[X] vs [Y]: [N] Key Differences [and Which to Choose]'.\nLede (word range and paragraph count from Gate Settings): bold verdict '[X] suits..., [Y] suits...; the deciding factor is...'; roadmap.\n\nSECTIONS IN ORDER:\n1. H2 'Understanding [X]' (~450w):\n   - H3 'Definition' (one quotable sentence + one well-known example)\n   - H3 'Types of [X]' ([TABLE: Type | Description])\n   - H3 '[X]: Pros and Cons' ([TABLE: Pros | Cons], each point '**Label**: explanation')\n2. H2 'Understanding [Y]' (~450w): exactly symmetric with X:\n   - H3 'Definition' · H3 'Types of [Y]' · H3 '[Y]: Pros and Cons'\n3. H2 '[M] Similarities Between [X] and [Y]' (~280w): H3 '1. [Similarity]' ... H3 '[M]. ...' (~60w each).\n4. H2 '[N] Differences Between [X] and [Y]' (~1,000w): [TABLE: Factor | [X] | [Y]] with N rows in the order of the H3s below.\n   - H3 '1. [Factor]' ... H3 '[N]. [Factor]' (micro-template DF).\n5. H2 '[X] or [Y]: Which One Your Project Needs' (~450w): [TABLE: Choose | When | Typical use | Watch out for].\n   - H3 '1. [Deciding factor]' ... H3 '[K]. [Deciding factor]', each ending 'Choose [X] if... Choose [Y] if...'. A hybrid option (for example 2.5D) goes in the H2 lead-in if relevant.\n6. H2 'Partnering with F.Learning for Your [Project]' (~250w):\n   - H3 '1. [Reason + proof]' · H3 '2. [Reason + proof]' · H3 '3. [Reason + proof, how F helps choose between X and Y]'\n7. H2 'FAQs About [X] vs [Y]' (~300w), last section:\n   - H3 'Which Is Better: [X] or [Y]?' · H3 'Is [X] Cheaper Than [Y]?' · H3 'Is [X] Easier Than [Y]?' · H3 'Should I [Learn/Choose] [X] or [Y]?' · H3 [another People Also Ask question]\n\nMICRO-TEMPLATE DF (each difference): paragraph 1 = how X handles the factor; paragraph 2 = 'In contrast,' / 'On the other hand,' how Y handles it.\n\nSECTION COUNT: about 34-40 sections (H2 + H3).\n\nGENERAL (all page types):\n- Headings are reader-ready English in Title Case. Replace [X], [Y], [N], [Year] with real values; keep the structure and order below.\n- Only H2 and H3. Never H4. Sub-blocks inside an H3 (proofs, case study) are labelled bullets or bold lead-in labels in that section's notes, not headings.\n- The outline contains body sections only. Never add a closing section to the outline. The platform appends exactly one closing H2 to the final draft, using Gate Settings conclusionHeading (recommended: 'Where to Start'). That final draft heading is permitted outside the outline. The FAQ H2 is the last section of the outline.\n- Count H2 and H3 together as sections; this layout needs the section count given below even when a generic prompt suggests fewer.\n- In each section's notes: the main points, required blocks ([TABLE: columns], CTA), which Article Spec items it delivers (questions, contentGaps, informationGain, citationTargets, brandAssets), the internal link target type if any (at most one per section), and an optional 'Image idea: ...' for the editor.\n- Facts not in Domain Knowledge are never planned as content; write 'Owner to confirm: ...' in the notes instead.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "draftInstructions": "- The two Understanding blocks are strictly symmetric: same H3s, same table types, same order.\n- Pros and cons are factual and do not lean toward what F sells; F's strengths belong only in the Partnering section.\n\nGENERAL (all page types):\n- Section content is prose, Markdown tables and labelled bullets ('- **Label:** content'). Never write a heading inside a section and never an image marker, image URL or placeholder such as [CẦN XÁC NHẬN] or [TBD].\n- First sentence of every section: a short, quotable claim. Paragraphs of 2-4 sentences.\n- An H2 that has H3 children gets 1-3 lead-in sentences only.\n- Every table is followed by 1-2 sentences that interpret it ('The common mistake is...').\n- At most one internal link per section, only from the approved Website Inventory list, with a descriptive anchor.\n- The closing (appended automatically, heading and word budget from Gate Settings): give a concrete next step, then verified contact details only when supplied in the approved evidence. Never invent contact details.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "requiredHeadings": [
        {
          "heading": "Understanding [X]",
          "level": "h2"
        },
        {
          "heading": "Understanding [Y]",
          "level": "h2"
        },
        {
          "heading": "[M] Similarities Between [X] and [Y]",
          "level": "h2"
        },
        {
          "heading": "[N] Differences Between [X] and [Y]",
          "level": "h2"
        },
        {
          "heading": "[X] or [Y]: Which One Your Project Needs",
          "level": "h2"
        },
        {
          "heading": "Partnering with F.Learning for Your [Project]",
          "level": "h2"
        },
        {
          "heading": "FAQs About [X] vs [Y]",
          "level": "h2"
        }
      ]
    },
    {
      "id": "fl-t4-service-toplist",
      "name": "T4 Service Toplist (Best [X] Services)",
      "description": "Walks the buyer through route (freelance or studio), the studio list, how to choose, cost and format. F.Learning is studio 1 with a disclosure. Model: '10 Best 2D & 3D Animation Services for 2026 Success'. Target about 3,800 words.",
      "useWhen": "The primary query is '[X] services', 'hire [X]' or 'best [X] services' and the reader is still weighing route or price.",
      "outlineInstructions": "PURPOSE: the full buying journey: route -> list -> how to choose -> cost -> format.\n\nH1: '[N] Best [X] Services for [Year]'.\nLede (word range and paragraph count from Gate Settings): bold answer: the 2 routes, when to use which, a price summary only if Domain Knowledge has one; paragraph 2 = roadmap with the italic disclosure as its last sentence.\n\nSECTIONS IN ORDER:\n1. H2 'Freelance Platforms for [X] Services' (~300w): who freelancing suits; [TABLE: Platform | Types of Service | Price Range] (price cells only from Domain Knowledge, otherwise drop the column); the trade-off (uneven quality, self-management, no review step) leading to studios; link: hire-a-studio page. No H3.\n2. H2 'Top [N] Professional Studios for [X] Services' (~1,700w): what a studio gives that a freelancer does not; [TABLE: Company | Overview | Key Services | Rating (source)].\n   - H3 '1. F.Learning' (~550w): introduction + link to the service page, then these labelled blocks as bold lead-in labels (never headings):\n     **[Proof 1: industry expertise]** · **[Proof 2: track record + client feedback]** · **[Proof 3: process + offer]** (Free Consultation, Free Animation Demo) · **Case Study: [Result with a number] for [Client]** (micro-template CS).\n   - H3 '2. [Studio]' ... H3 '[N]. [Studio]' (~110w each, micro-template SV, data only from Competitor profiles).\n3. H2 'How to Choose the Best Partner for Your [X] Project' (~550w): [TABLE: Criteria | Description | Key Actions] with 6-9 criteria and concrete actions. No H3.\n4. H2 '[X] Cost: Freelancer vs Small Studio vs Professional Company' (~550w): [TABLE: Type | Freelancer | Small studio | Professional company], cells 'per minute', only values from Domain Knowledge (otherwise describe the tiers without figures).\n   - H3 'Factors Influencing Costs' ([TABLE: Factor | What It Is], about 10-14 factors; link: cost page).\n5. H2 '[Format A] vs [Format B]: Which One Suits Your Project' (~450w), ending with a link to the comparison article if in the inventory:\n   - H3 'Project Goals & Purpose' · H3 'Target Audience and Industry' · H3 'Budget' · H3 'Timeline and Production Time' · H3 'Level of Detail & Realism' · H3 'Future Scalability & Updates' (~65w each, ending 'choose A if... / B if...').\n6. H2 'FAQs About [X] Services' (~280w), last section:\n   - H3 'How Much Do [X] Services Cost?' · H3 'Should I Hire a Freelancer or a Studio for [X]?' · H3 'How Long Does [an X] Project Take?' · H3 '[Format A] or [Format B] for [Purpose]?'\n\nMICRO-TEMPLATE SV (each competitor studio):\n- **Who they are:** ...\n- **What they offer:** ...\n- **Notable clients:** ...\n- **Rating/reviews:** [x.x] on [Clutch/Trustpilot] (as of [Month Year])\n- **Website:** domain\n- **Best fit for:** ...\n\nMICRO-TEMPLATE CS (F's case study, inside F's H3):\n**Overview:** context + goal (~50w). **How we did it:** 2-3 labelled bullets (approach, style, process). **Outcome:** 2-4 bullets, each with a measurable figure from the fact sheet.\n\nSECTION COUNT: about 26-30 sections (H2 + H3).\n\nGENERAL (all page types):\n- Headings are reader-ready English in Title Case. Replace [X], [Y], [N], [Year] with real values; keep the structure and order below.\n- Only H2 and H3. Never H4. Sub-blocks inside an H3 (proofs, case study) are labelled bullets or bold lead-in labels in that section's notes, not headings.\n- The outline contains body sections only. Never add a closing section to the outline. The platform appends exactly one closing H2 to the final draft, using Gate Settings conclusionHeading (recommended: 'Where to Start'). That final draft heading is permitted outside the outline. The FAQ H2 is the last section of the outline.\n- Count H2 and H3 together as sections; this layout needs the section count given below even when a generic prompt suggests fewer.\n- In each section's notes: the main points, required blocks ([TABLE: columns], CTA), which Article Spec items it delivers (questions, contentGaps, informationGain, citationTargets, brandAssets), the internal link target type if any (at most one per section), and an optional 'Image idea: ...' for the editor.\n- Facts not in Domain Knowledge are never planned as content; write 'Owner to confirm: ...' in the notes instead.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "draftInstructions": "- Studios are H3 under the 'Top N' H2. F's proofs and case study are bold lead-in labels inside F's H3, never headings.\n- Summary tables come before the details. The format section only summarises and points to the comparison article.\n\nGENERAL (all page types):\n- Section content is prose, Markdown tables and labelled bullets ('- **Label:** content'). Never write a heading inside a section and never an image marker, image URL or placeholder such as [CẦN XÁC NHẬN] or [TBD].\n- First sentence of every section: a short, quotable claim. Paragraphs of 2-4 sentences.\n- An H2 that has H3 children gets 1-3 lead-in sentences only.\n- Every table is followed by 1-2 sentences that interpret it ('The common mistake is...').\n- At most one internal link per section, only from the approved Website Inventory list, with a descriptive anchor.\n- The closing (appended automatically, heading and word budget from Gate Settings): give a concrete next step, then verified contact details only when supplied in the approved evidence. Never invent contact details.\n\nAUTHORITY: platform contract > Gate Settings > Standards > selected structure/Playbook. Numeric word and section totals above describe the intended full format; the configured article word target wins. Never omit a required body block to meet a smaller target; flag an insufficient budget at outline review. Parent H2 word estimates include all child H3 prose, not the parent lead-in alone. A parent H2 with H3 children has only 1-3 lead-in sentences; substantive detail belongs under its H3s.",
      "requiredHeadings": [
        {
          "heading": "Freelance Platforms for [X] Services",
          "level": "h2"
        },
        {
          "heading": "Top [N] Professional Studios for [X] Services",
          "level": "h2"
        },
        {
          "heading": "How to Choose the Best Partner for Your [X] Project",
          "level": "h2"
        },
        {
          "heading": "[X] Cost: Freelancer vs Small Studio vs Professional Company",
          "level": "h2"
        },
        {
          "heading": "[Format A] vs [Format B]: Which One Suits Your Project",
          "level": "h2"
        },
        {
          "heading": "FAQs About [X] Services",
          "level": "h2"
        }
      ]
    }
  ]
}
```
