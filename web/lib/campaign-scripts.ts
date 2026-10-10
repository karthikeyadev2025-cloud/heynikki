// Ready-made goals for a calling campaign, one or two per kind of business.
//
// A campaign's script is the goal Nikki is given for the call — not words to
// read out — so these are written as instructions. Each asks for one thing
// and promises nothing the business would have to make good on: no seat, no
// price, no approval. The rules each kind of business must hold to on a call
// it places are added by the pipeline (OUTBOUND_RULES in
// voice-pipeline/main.py), whatever is typed here.
//
// Text in [square brackets] is for the business to replace.

export type CampaignScript = { id: string; group: string; label: string; script: string };

export const CAMPAIGN_SCRIPTS: CampaignScript[] = [
  {
    id: "edu-enquiry", group: "Education", label: "Admission enquiry follow-up",
    script: "You are calling someone who enquired about admission to [course or class]. Ask whether they are still looking, and for whom. If they are, invite them for a campus visit or a counselling session and agree a day and time. If they have questions about fees or seats, say the admissions team will confirm when they visit.",
  },
  {
    id: "edu-event", group: "Education", label: "Open day or entrance test invitation",
    script: "You are inviting this family to [the open day / the entrance test] on [date] at [time]. Say what it is in one sentence, ask whether they will come, and note how many people. If the date does not suit them, offer a campus visit on another day.",
  },
  {
    id: "re-sitevisit", group: "Real estate", label: "Site visit invitation",
    script: "You are calling someone who enquired about [project name] in [area]. Ask whether they are still looking for a property, and whether it is to live in or to invest. If they are interested, invite them for a site visit and agree a day and time this week. Do not discuss the price on the call — say the sales manager will go through it at the site.",
  },
  {
    id: "re-launch", group: "Real estate", label: "New launch to past enquiries",
    script: "You are telling a past enquirer about [new project or phase] in [area]: [one line on what it is]. Ask whether they would like the details sent on WhatsApp or would prefer a site visit. If they are no longer looking, thank them and end the call.",
  },
  {
    id: "hosp-followup", group: "Hospitals", label: "Follow-up visit reminder",
    script: "You are reminding a patient that a follow-up visit is due. Ask whether they would like an appointment and agree a day and time within OP hours. Do not mention the doctor, the department or the reason for the visit until you are sure you are speaking to the patient.",
  },
  {
    id: "hosp-camp", group: "Hospitals", label: "Health camp or check-up package",
    script: "You are inviting people to [the health camp / the check-up package] on [date] at [place]. Say what is included in one sentence, ask whether they would like to register, and note how many people. Give no medical advice on the call.",
  },
  {
    id: "cons-followup", group: "Consultancy", label: "Enquiry follow-up",
    script: "You are calling someone who enquired about [service — for example study abroad, a visa, a job placement]. Ask what they are planning and by when. Invite them for a consultation with a consultant and agree a day and time. If they ask about fees, timelines or their chances, say the consultant covers that in the consultation.",
  },
  {
    id: "cons-docs", group: "Consultancy", label: "Pending documents reminder",
    script: "You are reminding a client that some documents for their application are still pending. Ask when they can bring or send them to the office, and note the day. Do not read out or ask for document numbers on the call. If they have questions about their case, offer a callback from their consultant.",
  },
  {
    id: "loan-reminder", group: "Loan recovery", label: "Instalment due reminder",
    script: "You are calling from [lender name] about an instalment that is due on [date]. Once you are sure you are speaking to the borrower, remind them of the due date and ask whether they will be paying on time. If they will, thank them. If they will not, ask on which date they can pay and note it.",
  },
  {
    id: "loan-overdue", group: "Loan recovery", label: "Overdue instalment — promise to pay",
    script: "You are calling from [lender name] about an instalment that is overdue. Once you are sure you are speaking to the borrower, say the instalment is pending and ask on which date they can pay. Say the date back to confirm it. If they have a difficulty or a dispute, say an accounts officer will call them, and end the call. Payment is only through [the branch / the lender's app / the usual account].",
  },
  {
    id: "ins-lead", group: "Insurance", label: "New policy enquiry follow-up",
    script: "You are calling someone who enquired about [health / life / term / motor] insurance. Ask whether they are still looking and who the cover is for. Invite them to a meeting or a call with an advisor and agree a day and time. If they ask about premium or benefits, say the advisor will go through the options with them.",
  },
  {
    id: "ins-renewal", group: "Insurance", label: "Policy renewal reminder",
    script: "You are calling from [company name] because the customer's [health / motor / life] policy is due for renewal on [date]. Once you are sure you are speaking to the policyholder, tell them the renewal date and ask whether they would like to renew. If yes, say an advisor will call to complete it. If they are unsure, ask when to call again.",
  },
  {
    id: "ins-premium", group: "Insurance", label: "Premium due reminder",
    script: "You are calling from [company name] about a premium that is due on [date]. Once you are sure you are speaking to the policyholder, remind them of the due date and ask whether they will be paying by then. If they need help, say an advisor will call. Payment is only through [the branch / the company's app / their advisor].",
  },
  {
    id: "ins-lapsed", group: "Insurance", label: "Lapsed policy revival",
    script: "You are calling from [company name] because the customer's policy has lapsed after a missed premium. Once you are sure you are speaking to the policyholder, tell them the policy can be revived and ask whether they would like an advisor to call and explain how. If they do not want to continue, thank them and end the call.",
  },
  {
    id: "ins-motor", group: "Insurance", label: "Motor insurance expiry",
    script: "You are calling vehicle owners whose motor insurance expires on [date or this month]. Ask whether they have renewed it already. If not, ask whether they would like a quotation from an advisor and what time suits them for the call. Do not quote a premium yourself.",
  },
  {
    id: "ins-claimdocs", group: "Insurance", label: "Claim documents pending",
    script: "You are calling from [company name] about a claim the customer has filed, for which some documents are still pending. Once you are sure you are speaking to the policyholder, ask when they can submit the pending documents to [the branch / their advisor] and note the day. Do not say anything about whether the claim will be approved. If they have questions, say the claims team will call.",
  },
  {
    id: "ins-crosssell", group: "Insurance", label: "Existing customers — another cover",
    script: "You are calling existing customers of [company name] to tell them about [health / term / top-up cover] in one sentence: [what it is]. Ask whether they would like an advisor to explain it, and what time suits them. If they are not interested, thank them and end the call.",
  },
  {
    id: "ins-feedback", group: "Insurance", label: "Service feedback after a claim or purchase",
    script: "You are calling a customer after [their claim was settled / their policy was issued]. Ask whether the service was satisfactory and whether they received their [policy document / claim payment]. If there is a problem, note it and say the service team will call back. If all is well, thank them and end the call.",
  },
  {
    id: "ins-agent", group: "Insurance", label: "Advisor / agent recruitment",
    script: "You are calling people who showed interest in becoming an insurance advisor with [company name]. Ask whether they are still interested and what they do at present. Invite them to [the briefing session on date / a meeting at the branch] and agree a time. Do not state any income or commission figure.",
  },
  {
    id: "ind-dealer", group: "Industry", label: "Dealer or distributor enquiry follow-up",
    script: "You are calling someone who enquired about [product or dealership]. Ask which product they need, roughly what quantity, and for which city. Say the sales team will call with the quotation, and ask what time suits them. Do not give a price or a delivery date on the call.",
  },
  {
    id: "ind-service", group: "Industry", label: "After-service feedback",
    script: "You are calling a customer after [a delivery / an installation / a service visit]. Ask whether everything is working as expected. If there is a problem, note what it is and say the service team will call back. If all is well, thank them and end the call.",
  },
];
