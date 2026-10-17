module.exports = {
    key: 'swiftlogix',
    industry: 'logistics',
    company: { name: 'SwiftLogix', domain: 'swiftlogix' },
    owner: { title: 'Head of Operations' },
    people: [
        { key: 'marco', firstName: 'Marco', lastName: 'Rossi', title: 'Transport Planner', role: 'admin', designations: ['Manager', 'Operations Executive'] },
        { key: 'jada', firstName: 'Jada', lastName: 'Williams', title: 'Customer Service Lead', role: 'member', designations: ['Operations Executive'] },
        { key: 'kenji', firstName: 'Kenji', lastName: 'Watanabe', title: 'Warehouse Manager', role: 'admin', designations: ['Manager'] },
        { key: 'fatima', firstName: 'Fatima', lastName: 'Zahra', title: 'Inventory Controller', role: 'member', designations: ['Operations Executive'] },
        { key: 'lucas', firstName: 'Lucas', lastName: 'Oliveira', title: 'Procurement Buyer', role: 'member', designations: ['Operations Executive'] },
        { key: 'hannah', firstName: 'Hannah', lastName: 'Schmidt', title: 'Dispatch Coordinator', role: 'member', designations: ['Operations Executive'] },
    ],
    projects: [
        {
            key: 'ship',
            name: 'Shipments and Exceptions',
            code: 'SHIP',
            color: '#0369A1',
            lead: 'marco',
            members: ['marco', 'jada', 'hannah'],
            views: ['board', 'list', 'table', 'calendar', 'dashboard', 'docs'],
            summary: [
                'Every customer shipment from booking to delivery, by road, ocean and air. The board is the control tower: what is moving, what is late and what is stuck.',
                '',
                '- A delayed shipment goes to Customer Service automatically, with two hours to update the customer.',
                '- The Order Issue Triage agent turns every hold, delay or damage into a clear next step; the Delivery Tracker watches ETAs and cold-chain loads.',
                '- The Customer Update Writer drafts the message; a person sends it.',
            ].join('\n'),
            stages: [
                { name: 'Booked', goal: 'Carrier, mode, pickup and ETA confirmed.' },
                { name: 'In transit', goal: 'Collected; tracking reference recorded.' },
                { name: 'Delayed', goal: 'New ETA known and the customer told.' },
                { name: 'Exception', goal: 'Hold, damage or loss with an owner and a next step.' },
                { name: 'Delivered', goal: 'Proof of delivery received.' },
                { name: 'Closed', goal: 'Invoiced and any claim settled.' },
            ],
            essentials: ['A temperature-controlled load outside 2–8 °C', 'A customs hold', 'Damage on delivery'],
            escalations: ['A priority customer will miss a promised date', 'Cargo value above $100,000 on hold'],
            statuses: [
                { name: 'Booked', type: 'default_active', color: '#64748B' },
                { name: 'In transit', type: 'active', color: '#2563EB' },
                { name: 'Delayed', type: 'active', color: '#D97706' },
                { name: 'Exception', type: 'active', color: '#DC2626' },
                { name: 'Delivered', type: 'done', color: '#0D9488' },
                { name: 'Closed', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Shipment', icon: 'truck-delivery', color: '#0369A1' },
                { name: 'Claim', icon: 'file-alert', color: '#DC2626' },
                { name: 'Report', icon: 'file-chart', color: '#2563EB' },
            ],
            fields: [
                { key: 'customer', title: 'Customer', type: 'text' },
                { key: 'carrier', title: 'Carrier', type: 'dropdown', options: ['DHL Freight', 'Maersk', 'FedEx Freight', 'XPO', 'DB Schenker'] },
                { key: 'mode', title: 'Mode', type: 'dropdown', options: ['Road', 'Ocean', 'Air'] },
                { key: 'eta', title: 'ETA', type: 'date' },
                { key: 'value', title: 'Cargo value', type: 'money', currency: 'USD' },
                { key: 'ref', title: 'Tracking reference', type: 'text' },
            ],
            tags: [
                { name: 'temperature-controlled', color: '#0891B2' },
                { name: 'hazmat', color: '#DC2626' },
                { name: 'priority-customer', color: '#7C3AED' },
            ],
            tasks: [
                {
                    key: 'sh-88214', name: 'SH-88214 · Rotterdam → Chicago · Bluefin Grocers (reefer)', type: 'Shipment', status: 'In transit', priority: 'MEDIUM', assignees: ['marco'], due: 1,
                    fields: { customer: 'Bluefin Grocers', carrier: 'Maersk', mode: 'Ocean', eta: 1, value: 64800, ref: 'MSKU 482190-3' }, tags: ['temperature-controlled', 'priority-customer'],
                    description: 'One 40-foot reefer of chilled seafood at 2 °C. Bluefin starts a store promotion three days after the planned delivery.',
                },
                {
                    key: 'sh-88231', name: 'SH-88231 · Shenzhen → Los Angeles · Volt Electronics', type: 'Shipment', status: 'In transit', priority: 'HIGH', assignees: ['marco'], due: 0,
                    fields: { customer: 'Volt Electronics', carrier: 'Maersk', mode: 'Ocean', eta: 0, value: 186400, ref: 'MAEU 7731028' },
                    description: 'Two 40-foot containers of consumer electronics. Arrived at the Port of Los Angeles this morning.',
                },
                {
                    key: 'sh-88245', name: 'SH-88245 · Atlanta → Miami · Sunrise Pharmacy (2–8 °C)', type: 'Shipment', status: 'In transit', priority: 'HIGH', assignees: ['hannah'], due: 1,
                    fields: { customer: 'Sunrise Pharmacy', carrier: 'FedEx Freight', mode: 'Road', eta: 1, value: 42300, ref: 'FXF 30918844' }, tags: ['temperature-controlled', 'priority-customer'],
                },
                {
                    key: 'sh-88227', name: 'SH-88227 · Houston → Phoenix · Desert Solar', type: 'Shipment', status: 'Exception', priority: 'HIGH', assignees: ['jada'], due: -1, overdue: true,
                    fields: { customer: 'Desert Solar', carrier: 'XPO', mode: 'Road', value: 58200, ref: 'XPO 66120943' },
                    description: 'Delivered with 3 of 12 pallets of panel mounts crushed. The customer signed the delivery note "damaged".',
                },
                {
                    key: 'claim-0071', name: 'Claim CL-0071 · 3 damaged pallets on SH-88227', type: 'Claim', status: 'Exception', priority: 'MEDIUM', assignees: ['jada'], due: 6, blockedBy: ['sh-88227'],
                    fields: { customer: 'Desert Solar', carrier: 'XPO', value: 14550 },
                    checklist: [{ text: 'Photos from the delivery driver', done: true }, { text: 'Signed delivery note marked damaged', done: true }, { text: 'Commercial invoice for the damaged pallets' }, { text: 'File the claim with XPO within 9 months' }],
                },
                {
                    key: 'sh-88250', name: 'SH-88250 · Hamburg → Newark · Nordic Furniture', type: 'Shipment', status: 'Booked', priority: 'MEDIUM', assignees: ['marco'], due: 18,
                    fields: { customer: 'Nordic Furniture', carrier: 'DB Schenker', mode: 'Ocean', eta: 18, value: 97500 },
                },
                {
                    key: 'sh-88252', name: 'SH-88252 · Memphis → Columbus · Volt Electronics', type: 'Shipment', status: 'Booked', priority: 'LOW', assignees: ['hannah'], due: 3,
                    fields: { customer: 'Volt Electronics', carrier: 'DHL Freight', mode: 'Road', eta: 3, value: 22100 },
                },
                {
                    key: 'sh-88256', name: 'SH-88256 · Seattle → Anchorage · Northstar Clinics', type: 'Shipment', status: 'Booked', priority: 'MEDIUM', assignees: ['hannah'], due: 2,
                    fields: { customer: 'Northstar Clinics', carrier: 'FedEx Freight', mode: 'Air', eta: 2, value: 18900 }, tags: ['hazmat'],
                    description: 'Includes lithium batteries for medical devices (UN3481). Dangerous-goods declaration required before pickup.',
                },
                {
                    key: 'sh-88240', name: 'SH-88240 · Dallas → Denver · Peak Outdoor', type: 'Shipment', status: 'Delivered', priority: 'LOW', assignees: ['hannah'], due: -1,
                    fields: { customer: 'Peak Outdoor', carrier: 'XPO', mode: 'Road', value: 31800 },
                },
                {
                    key: 'digest', name: 'Daily control tower digest', type: 'Report', status: 'Booked', priority: 'LOW', assignees: ['you'], due: 2,
                    description: 'Where the Control Tower Digest agent posts its board summary. Run it from AI, Agents, Run now, and pick this task.',
                },
                {
                    key: 'sh-88198', name: 'SH-88198 · Chicago → Toronto · Maple Hardware', type: 'Shipment', status: 'Closed', priority: 'LOW', assignees: ['marco'], due: -6,
                    fields: { customer: 'Maple Hardware', carrier: 'DHL Freight', mode: 'Road', value: 27450 },
                },
            ],
        },
        {
            key: 'wh',
            name: 'Warehouse Operations',
            code: 'WH',
            color: '#15803D',
            lead: 'kenji',
            members: ['kenji', 'fatima', 'hannah'],
            views: ['board', 'list', 'workload'],
            summary: [
                'Outbound orders, replenishment and cycle counts at the Dallas distribution centre.',
                '',
                '- A short pick alerts inventory control at once, so the customer order is split or re-sourced the same day.',
                '- The Stock Alert agent compares stock with open orders and prepares the reorder list; the Dispatch Checklist agent prepares each load before it leaves.',
            ].join('\n'),
            stages: [
                { name: 'Queued', goal: 'Order released to the floor.' },
                { name: 'Picking', goal: 'Being picked against the pick list.' },
                { name: 'Short', goal: 'A line cannot be filled; inventory control decides.' },
                { name: 'Staged at dock', goal: 'Checked, labelled and waiting for the truck.' },
                { name: 'Loaded', goal: 'On the truck, seal recorded.' },
                { name: 'Complete', goal: 'Departed and handed to Shipments.' },
            ],
            essentials: ['A short line on a priority customer order', 'Cold-chain orders waiting more than 30 minutes at the dock'],
            escalations: ['Stock below safety level on a fast mover'],
            statuses: [
                { name: 'Queued', type: 'default_active', color: '#64748B' },
                { name: 'Picking', type: 'active', color: '#2563EB' },
                { name: 'Short', type: 'active', color: '#DC2626' },
                { name: 'Staged at dock', type: 'active', color: '#0891B2' },
                { name: 'Loaded', type: 'done', color: '#7C3AED' },
                { name: 'Complete', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Outbound order', icon: 'package-variant-closed', color: '#15803D' },
                { name: 'Replenishment', icon: 'warehouse', color: '#D97706' },
                { name: 'Cycle count', icon: 'clipboard-list', color: '#64748B' },
            ],
            fields: [
                { key: 'sku', title: 'SKU', type: 'text' },
                { key: 'qty', title: 'Quantity', type: 'number' },
                { key: 'onhand', title: 'On hand', type: 'number' },
                { key: 'bin', title: 'Bin location', type: 'text' },
                { key: 'dock', title: 'Dock', type: 'dropdown', options: ['Dock 1', 'Dock 2', 'Dock 3'] },
            ],
            tags: [
                { name: 'rush', color: '#DC2626' },
                { name: 'cold-chain', color: '#0891B2' },
            ],
            tasks: [
                {
                    key: 'wo-5517', name: 'WO-5517 · Sunrise Pharmacy · 6 pallets at 2–8 °C', type: 'Outbound order', status: 'Picking', priority: 'HIGH', assignees: ['hannah'], due: 0,
                    fields: { qty: 6, dock: 'Dock 3' }, tags: ['cold-chain', 'rush'],
                },
                {
                    key: 'wo-5520', name: 'WO-5520 · Peak Outdoor · 120 four-person tents', type: 'Outbound order', status: 'Picking', priority: 'MEDIUM', assignees: ['kenji'], due: 1,
                    fields: { sku: 'TNT-4P', qty: 120, onhand: 38, bin: 'A12-04', dock: 'Dock 1' },
                },
                {
                    key: 'wo-5512', name: 'WO-5512 · Bluefin Grocers · 18 pallets of dry goods', type: 'Outbound order', status: 'Staged at dock', priority: 'MEDIUM', assignees: ['kenji'], due: 0,
                    fields: { qty: 18, dock: 'Dock 2' },
                },
                {
                    key: 'wo-5509', name: 'WO-5509 · Volt Electronics · 30 cartons', type: 'Outbound order', status: 'Loaded', priority: 'LOW', assignees: ['hannah'], due: 0,
                    fields: { qty: 30, dock: 'Dock 1' },
                },
                {
                    key: 'wo-5506', name: 'WO-5506 · Desert Solar · 12 pallets of panel mounts', type: 'Outbound order', status: 'Complete', priority: 'LOW', assignees: ['hannah'], due: -2,
                    fields: { qty: 12 },
                },
                {
                    key: 'wo-5523', name: 'WO-5523 · Maple Hardware · 4 pallets', type: 'Outbound order', status: 'Queued', priority: 'LOW', assignees: ['kenji'], due: 2,
                    fields: { qty: 4 },
                },
                {
                    key: 'rp-tent', name: 'Replenish TNT-4P four-person tents', type: 'Replenishment', status: 'Queued', priority: 'HIGH', assignees: ['fatima'], due: 1,
                    fields: { sku: 'TNT-4P', qty: 200, onhand: 38, bin: 'A12-04' }, blockedBy: ['supp.po-7781'],
                },
                {
                    key: 'rp-gloves', name: 'Replenish GLV-NIT-L nitrile gloves', type: 'Replenishment', status: 'Queued', priority: 'MEDIUM', assignees: ['fatima'], due: 4,
                    fields: { sku: 'GLV-NIT-L', qty: 500, onhand: 140, bin: 'C03-11' }, blockedBy: ['supp.po-7790'],
                },
                {
                    key: 'cc-a12', name: 'Cycle count · aisle A12 (fast movers)', type: 'Cycle count', status: 'Queued', priority: 'MEDIUM', assignees: ['fatima'], due: 2,
                    checklist: ['Freeze movements in A12 for 30 minutes', 'Count every bin twice', 'Post variances above 2% for review'],
                },
            ],
        },
        {
            key: 'supp',
            name: 'Suppliers and Purchasing',
            code: 'SUPP',
            color: '#B45309',
            lead: 'lucas',
            members: ['lucas', 'fatima', 'kenji'],
            views: ['board', 'table', 'list'],
            summary: [
                'Purchase orders for stock and consumables, from order to receipt. Late orders are chased the same day.',
                '',
                '- A purchase order marked Late goes to the buyer automatically with the chase as the next step.',
                '- The Supplier Follow-up agent finds late orders and drafts the chase; the buyer sends it.',
            ].join('\n'),
            stages: [
                { name: 'Ordered', goal: 'PO sent with quantity, price and promised date.' },
                { name: 'Confirmed', goal: 'Supplier confirmed the date in writing.' },
                { name: 'Late', goal: 'Past the promised date; chased and a new date recorded.' },
                { name: 'Partially received', goal: 'Some lines received; the rest has a date.' },
                { name: 'Received', goal: 'All lines received and put away.' },
                { name: 'Closed', goal: 'Invoice matched and paid.' },
            ],
            statuses: [
                { name: 'Ordered', type: 'default_active', color: '#64748B' },
                { name: 'Confirmed', type: 'active', color: '#2563EB' },
                { name: 'Late', type: 'active', color: '#DC2626' },
                { name: 'Partially received', type: 'active', color: '#D97706' },
                { name: 'Received', type: 'done', color: '#0D9488' },
                { name: 'Closed', type: 'close', color: '#16A34A' },
            ],
            types: [
                { name: 'Purchase order', icon: 'clipboard-text', color: '#B45309' },
            ],
            fields: [
                { key: 'supplier', title: 'Supplier', type: 'text' },
                { key: 'promised', title: 'Promised date', type: 'date' },
                { key: 'value', title: 'Order value', type: 'money', currency: 'USD' },
                { key: 'otif', title: 'Supplier on-time in full %', type: 'number' },
            ],
            tags: [
                { name: 'single-source', color: '#DC2626' },
            ],
            tasks: [
                {
                    key: 'po-7781', name: 'PO-7781 · TrailCo · 200 × TNT-4P tents', type: 'Purchase order', status: 'Confirmed', priority: 'HIGH', assignees: ['lucas'], due: -2, overdue: true,
                    fields: { supplier: 'TrailCo', promised: -2, value: 16400, otif: 82 }, tags: ['single-source'],
                },
                {
                    key: 'po-7790', name: 'PO-7790 · SafeHands · 50,000 nitrile gloves', type: 'Purchase order', status: 'Confirmed', priority: 'MEDIUM', assignees: ['lucas'], due: 3,
                    fields: { supplier: 'SafeHands', promised: 3, value: 4250, otif: 96 },
                },
                {
                    key: 'po-7774', name: 'PO-7774 · PalletPro · 400 Euro pallets', type: 'Purchase order', status: 'Partially received', priority: 'MEDIUM', assignees: ['lucas'], due: 2,
                    fields: { supplier: 'PalletPro', promised: 2, value: 6800, otif: 91 },
                    description: '250 of 400 pallets received. The rest is promised in two days.',
                },
                {
                    key: 'po-7765', name: 'PO-7765 · ColdBox · 60 insulated pallet covers', type: 'Purchase order', status: 'Received', priority: 'LOW', assignees: ['lucas'], due: -1,
                    fields: { supplier: 'ColdBox', promised: -1, value: 5100, otif: 98 },
                },
                {
                    key: 'po-7752', name: 'PO-7752 · TapeWorks · 120 rolls of stretch film', type: 'Purchase order', status: 'Closed', priority: 'LOW', assignees: ['lucas'], due: -9,
                    fields: { supplier: 'TapeWorks', promised: -9, value: 1980, otif: 99 },
                },
                {
                    key: 'po-7795', name: 'PO-7795 · LabelTech · thermal labels and ribbons', type: 'Purchase order', status: 'Ordered', priority: 'LOW', assignees: ['lucas'], due: 8,
                    fields: { supplier: 'LabelTech', promised: 8, value: 2340 },
                },
            ],
        },
    ],
    agents: [
        { key: 'triage', role: 'ecommerce/order-issue-triage', projects: ['ship'], does: 'Turns every hold, delay or damage into a clear exception with an owner and a next step.' },
        { key: 'tracker', role: 'manufacturing/delivery-tracker', projects: ['ship'], does: 'Follows shipments after pickup and flags those that will miss their ETA.' },
        { key: 'updates', role: 'manufacturing/customer-update-writer', projects: ['ship'], does: 'Drafts the customer message when a date moves; a person sends it.' },
        { key: 'stock', role: 'ecommerce/stock-alert', projects: ['wh'], does: 'Compares stock with open orders and prepares the reorder list.' },
        { key: 'dispatch', role: 'manufacturing/dispatch-checklist', projects: ['wh'], does: 'Builds the checklist before a load leaves: quantities, documents, temperature, seals.' },
        { key: 'suppliers', role: 'manufacturing/supplier-follow-up', projects: ['supp'], does: 'Finds late purchase orders and drafts the chase for the buyer.' },
        { key: 'digest', skill: 'digest.ceo', name: 'Control Tower Digest', description: 'Posts a short digest of the shipments board: what moved, what is late, what is held.', projects: ['ship'], does: 'Counts the shipments board and posts what moved, what is late and what is held.' },
    ],
    automations: [
        {
            name: 'Delayed shipments go to Customer Service',
            project: 'ship',
            when: { statusTo: 'Delayed' },
            then: [
                { priority: 'HIGH' },
                { assign: ['jada'] },
                { comment: 'Delay logged by automation. Customer Service updates the customer within 2 hours with the new ETA; the Customer Update Writer can draft the message.' },
            ],
        },
        {
            name: 'A short pick alerts inventory control',
            project: 'wh',
            when: { statusTo: 'Short' },
            then: [
                { priority: 'HIGH' },
                { assign: ['fatima'] },
                { notify: { people: ['kenji', 'you'], message: 'A pick is short: check the bin and decide whether to split or re-source the order.' } },
            ],
        },
        {
            name: 'Late purchase orders get chased today',
            project: 'supp',
            when: { statusTo: 'Late' },
            then: [
                { priority: 'HIGH' },
                { comment: 'Marked late by automation: chase the supplier today and record the new promised date on this order.' },
            ],
        },
    ],
    story: [
        { move: 'ship.sh-88214', to: 'Delayed', by: 'marco' },
        { comment: 'ship.sh-88214', by: 'marco', text: 'Congestion in Rotterdam: the vessel berths two days late. New ETA Chicago is two days after plan, still one day before Bluefin\'s promotion. Reefer power confirmed at the terminal.' },
        {
            proposal: 'updates', task: 'ship.sh-88214', summary: 'Drafted the delay message for Bluefin Grocers and the new due date.',
            what: 'Send Bluefin Grocers the new delivery date for SH-88214',
            why: 'The ETA moved by two days and Bluefin is a priority customer with a promotion starting the day after the new date.',
            changes: [
                { comment: 'Draft for Jada to send: "Hi Sara, your reefer container SH-88214 (Rotterdam → Chicago) is delayed by port congestion. It now arrives two days later than planned, still the day before your promotion starts. The temperature has stayed at 2 °C throughout, and we will confirm the delivery slot tomorrow."' },
                { due: 3 },
            ],
            priority: 'high',
        },
        { move: 'ship.sh-88231', to: 'Exception', by: 'marco' },
        {
            agentRun: 'triage', task: 'ship.sh-88231', summary: 'Classified the customs hold on SH-88231 and named the missing document.',
            text: 'Exception: customs hold at the Port of Los Angeles. CBP flagged the entry because the commercial invoice is missing from the filing. Cargo value $186,400; storage charges start after 2 free days. Next step: Volt Electronics\' broker uploads the commercial invoice today. Owner: Marco.',
        },
        { comment: 'ship.sh-88231', by: 'jada', text: 'Volt\'s broker has the invoice and promised the upload by 3 pm Pacific. I will tell their logistics manager once CBP releases it.' },
        { move: 'wh.wo-5520', to: 'Short', by: 'kenji' },
        {
            agentRun: 'stock', task: 'wh.rp-tent', summary: 'Found TNT-4P short against open orders.',
            text: 'Stock alert: TNT-4P has 38 on hand against 120 on open orders (WO-5520), so 82 are short. PO-7781 for 200 is two days late at TrailCo. Options for the buyer: split WO-5520 (38 now, 82 when PO-7781 lands) or move 82 from the Reno centre, which holds 140.',
        },
        {
            proposal: 'stock', task: 'wh.wo-5520', summary: 'Proposed splitting WO-5520 so Peak Outdoor gets 38 tents today.',
            what: 'Split WO-5520: ship 38 tents today and back-order 82',
            why: 'Only 38 TNT-4P are in stock and the replenishment order is late. Peak Outdoor\'s account accepts partial shipments.',
            changes: [
                { comment: 'Proposed split: ship 38 TNT-4P today from bin A12-04 and back-order 82 against PO-7781. Peak Outdoor accepts partial shipments under its account terms.' },
                { subtask: { title: 'Back-order 82 × TNT-4P for Peak Outdoor', description: 'Release when PO-7781 is received.' } },
            ],
        },
        { move: 'supp.po-7781', to: 'Late', by: 'lucas' },
        {
            proposal: 'suppliers', task: 'supp.po-7781', summary: 'Drafted the chase to TrailCo for PO-7781.',
            what: 'Chase TrailCo for PO-7781 and give it a new promised date',
            why: 'TrailCo promised delivery two days ago and has not sent a ship notice; 82 tents are back-ordered for a customer.',
            changes: [
                { comment: 'Draft chase for Lucas to send: "Hi Megan, PO-7781 (200 × TNT-4P) was due two days ago and we have no ship notice. Please confirm the dispatch date and the carrier reference today: 82 units are back-ordered for a customer."' },
                { due: 2 },
            ],
        },
        {
            agentRun: 'tracker', task: 'ship.sh-88245', summary: 'Checked the cold-chain load: on schedule.',
            text: 'Cold-chain check: SH-88245 is on schedule for delivery tomorrow morning. The last temperature reading was 4.1 °C, inside the 2–8 °C range. Nothing to do.',
        },
        {
            agentRun: 'dispatch', task: 'wh.wo-5517', summary: 'Built the dispatch checklist for the Sunrise Pharmacy load.',
            text: 'Dispatch checklist for WO-5517 (Sunrise Pharmacy, 2–8 °C): 6 pallets picked · temperature logger fitted · trailer pre-cooled to 4 °C · good-distribution-practice certificate attached · seal number to record at loading · delivery slot 07:00–09:00 confirmed.',
        },
        { comment: 'wh.wo-5517', by: 'hannah', text: 'The reefer trailer from Coldline reaches Dock 3 at 16:00.' },
    ],
    routing: {
        ship: [
            { agent: 'triage', statuses: ['Exception', 'Delayed'] },
            { agent: 'tracker', types: ['Shipment'] },
            { agent: 'triage', types: ['Claim'] },
        ],
        wh: [
            { agent: 'dispatch', types: ['Outbound order'] },
            { agent: 'stock', types: ['Replenishment', 'Cycle count'] },
        ],
        supp: [
            { agent: 'suppliers', types: ['Purchase order'] },
        ],
    },
    handOvers: [
        { task: 'ship.sh-88227', by: 'marco' },
        { task: 'wh.wo-5512', by: 'kenji' },
        { task: 'supp.po-7790', by: 'lucas' },
    ],
    workflows: {
        own: {
            key: 'shipment-exception-update',
            name: 'Shipments: from an exception to the customer update',
            description: 'The Order Issue Triage agent classifies the exception and names the next step, the Customer Update Writer drafts the message, a person sends it and approves, and the Delivery Tracker follows the shipment to delivery.',
            steps: [
                { id: 'sTriage', agent: 'triage' },
                { id: 'sDraft', agent: 'updates' },
                {
                    id: 'sSendOk',
                    approval: {
                        title: 'Send the customer update',
                        prompt: 'The update is drafted on the shipment. Send it to the customer yourself, then approve; agents never send messages outside AlianHub.',
                        owner: 'you',
                    },
                },
                { id: 'sTrack', agent: 'tracker' },
            ],
            run: { task: 'ship.sh-88231', by: 'marco' },
        },
    },
    goals: [
        {
            name: 'On-time delivery at 95% or better',
            description: 'Shipments delivered on the promised date, with no temperature excursions.',
            color: '#0369A1',
            targets: [
                { name: 'Shipments delivered this week', kind: 'tasks', tasks: ['ship.sh-88214', 'ship.sh-88231', 'ship.sh-88245', 'ship.sh-88240', 'ship.sh-88198', 'ship.sh-88252'] },
                { name: 'No temperature excursions this month', kind: 'boolean', done: true },
            ],
        },
        {
            name: 'Ship every order complete',
            description: 'Outbound orders leave complete, without short lines.',
            color: '#15803D',
            targets: [{ name: 'Outbound orders complete', kind: 'tasks', tasks: ['wh.wo-5517', 'wh.wo-5520', 'wh.wo-5512', 'wh.wo-5509', 'wh.wo-5506', 'wh.wo-5523'] }],
        },
    ],
    dashboard: { name: 'Control tower', project: 'ship', cards: ['tasks_by_status', 'at_risk', 'due_soon', 'project_pulse'] },
    guide: {
        project: 'ship',
        intro: 'SwiftLogix moves freight for retailers, manufacturers and clinics by road, ocean and air, and runs a distribution centre in Dallas. You are signed in as the **Head of Operations**. **Shipments and Exceptions** is the control tower, **Warehouse Operations** picks and loads, and **Suppliers and Purchasing** keeps stock coming in. Role agents watch and draft; people decide and send.',
        tryThis: [
            'Open **Shipments and Exceptions** on the Board. SH-88214 is **Delayed**: when Marco moved it, the automation set it to High, assigned Jada and asked for a customer update within 2 hours.',
            'Open **Inbox → Approvals**. The Customer Update Writer has drafted Bluefin\'s delay message and the new date. Approve it: the comment and the new due date are applied for real, with Undo for 15 minutes.',
            'Open **SH-88231**: the Order Issue Triage agent named the missing commercial invoice behind the customs hold.',
            'In **Warehouse Operations**, WO-5520 is **Short**. The Stock Alert agent proposes splitting the order; the late purchase order behind it is in **Suppliers and Purchasing**, where the Supplier Follow-up agent has the chase ready.',
            'Move **SH-88252** to **Delayed** yourself and watch the automation fire. Every run is listed under **Automations** in the AI section.',
            'In **AI → Agents**, click **Run now** on the **Control Tower Digest** and pick **Daily control tower digest**. It runs for real, with no AI model, and posts a digest counted from the board on that task.',
            'Open the **Control tower** dashboard and **Goals**: both are counted from the tasks, so they change as you move work.',
        ],
    },
};
