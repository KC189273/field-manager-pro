import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx'

// GET — download barbershop setup guide as Word doc
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [
              new TextRun({ text: 'Field Manager Pro', size: 36, bold: true, color: '3B82F6' }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 },
            children: [
              new TextRun({ text: 'Barbershop Setup & Customer Guide', size: 28, bold: true }),
            ],
          }),

          // ── SECTION 1: BARBER/SHOP OWNER SETUP ──
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
            children: [new TextRun({ text: 'PART 1: Shop Owner / Barber Setup', bold: true, color: '3B82F6' })],
          }),

          ...step('Step 1: Log In', [
            'Open the Field Manager Pro app on your phone or go to fieldmanagerpro.app in your browser.',
            'Enter the username and temporary password provided to you by your administrator.',
            'You will be prompted to change your password on first login.',
          ]),

          ...step('Step 2: Set Up Your Shop', [
            'Navigate to "Shop Setup" in the bottom navigation bar.',
            'Under the "Shop Info" tab, fill in:',
            '   • Shop Name — the name customers will see',
            '   • 4-Letter Shop Code — a unique code customers enter to find your shop (e.g., CUTS, FADE)',
            '   • Address — your shop\'s physical address',
            '   • Phone — your shop\'s phone number',
            '   • List Yourself as a Barber — toggle this ON if you cut hair (ON by default)',
            'Tap "Save Shop Settings" when done.',
          ]),

          ...step('Step 3: Add Your Services', [
            'Go to the "Services" tab in Shop Setup.',
            'You\'ll see "Haircut" already added as a default service.',
            'To add more services:',
            '   • Enter the service name (e.g., "Beard Trim", "Line Up", "Full Service")',
            '   • Enter the price (e.g., 25.00)',
            '   • Enter the duration in minutes (default is 45)',
            '   • Tap "Add Service"',
            'You can remove services by tapping "Remove" next to them.',
            'If you only offer one service (just haircuts), customers will skip the service selection step automatically.',
          ]),

          ...step('Step 4: Set Your Hours', [
            'Go to the "Hours" tab in Shop Setup.',
            'Set your appointment duration (default 45 minutes) and cleanup time between appointments (default 15 minutes).',
            'For each day of the week:',
            '   • Toggle the checkbox ON for days you work, OFF for days off',
            '   • Set your start and end times',
            '   • Monday through Saturday are ON by default (9 AM – 6 PM)',
            '   • Sunday is OFF by default',
            'Tap "Save Hours" when done.',
          ]),

          ...step('Step 5: Set Up Payment', [
            'Go to the "Payment" tab in Shop Setup.',
            'Enter your Venmo username (without the @) and/or your Cash App tag (without the $).',
            'When customers book and you confirm, they\'ll see payment buttons with your price pre-filled.',
            'A "Tipping is always appreciated!" reminder is included automatically.',
          ]),

          ...step('Step 6: Get Your QR Code', [
            'After saving your shop settings with a 4-letter code, a QR code will appear at the bottom of the Shop Info tab.',
            'This QR code links directly to your shop\'s signup page with your code pre-filled.',
            'Print this QR code and display it:',
            '   • At your barber station',
            '   • On your front counter',
            '   • On business cards',
            '   • In your shop window',
            'When customers scan it, they\'re taken directly to sign up for your shop.',
          ]),

          ...step('Step 7: Add Additional Barbers (Shop Owners Only)', [
            'If you have other barbers in your shop, go to Shop Setup.',
            'Each barber you add will get their own login, their own services, their own hours, and their own appointment calendar.',
            'Contact your administrator to have additional barber accounts created.',
            'Each barber can then log in and set up their own services and availability.',
          ]),

          ...step('Step 8: Managing Appointments', [
            'Tap "Appointments" in the bottom navigation to see your calendar.',
            'You can switch between Day view (visual timeline), Week view, and List view.',
            'When a customer books:',
            '   • You\'ll receive a push notification',
            '   • The appointment appears as "Pending" in your calendar',
            '   • Tap it to Confirm or Decline',
            '   • If you decline, you can suggest an alternate date and time',
            '   • If you don\'t respond within 24 hours, it auto-expires',
            'After a confirmed appointment:',
            '   • Tap it and select "Mark Complete" when the customer\'s cut is done',
            '   • Add notes about the appointment if you like',
          ]),

          ...step('Step 9: Managing Customers', [
            'Tap "My Customers" in the bottom navigation.',
            'You\'ll see a list of all customers who have booked with you.',
            'Search by name, phone, or email.',
            'Tap any customer to see:',
            '   • Total visits and notes count',
            '   • Add personal notes (e.g., "Prefers a low fade", "Talks about the Bears")',
            '   • Full visit history with services and dates',
            'Notes help you build personal relationships and remember preferences.',
          ]),

          // ── SECTION 2: CUSTOMER INSTRUCTIONS ──
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 600, after: 200 },
            children: [new TextRun({ text: 'PART 2: Customer Instructions', bold: true, color: '3B82F6' })],
          }),

          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: 'Share these instructions with your customers:', italics: true, color: '666666' })],
          }),

          ...step('Step 1: Download the App', [
            'Download "Field Manager Pro" from the App Store (iPhone) or Google Play Store (Android).',
            'Or scan the QR code at the barber shop to go directly to the signup page.',
          ]),

          ...step('Step 2: Create Your Account', [
            'Open the app and tap "I\'m a customer — book an appointment" on the login screen.',
            'Enter the 4-letter shop code your barber gave you (or it\'s already filled in if you scanned the QR code).',
            'Tap "Continue" — you\'ll see the shop name appear.',
            'Fill in your information:',
            '   • Full Name',
            '   • Email Address',
            '   • Phone Number',
            'Tap "Continue to Book" — you\'re in!',
          ]),

          ...step('Step 3: Book an Appointment', [
            'After signing up, you\'ll be taken to the booking page.',
            'If the shop has multiple barbers, pick the one you want.',
            'If the barber offers multiple services, select what you need (you can pick more than one).',
            'Pick a date from the next 14 days.',
            'Pick an available time slot.',
            'Review your booking details (barber, date, time, services, price).',
            'Tap "Request Appointment" — your barber will be notified.',
          ]),

          ...step('Step 4: Confirmation', [
            'Your barber will confirm your appointment (usually within a few hours).',
            'You\'ll receive a push notification and email when confirmed.',
            'The confirmation includes:',
            '   • Barber name, date, time, and price',
            '   • Shop address',
            '   • Venmo and Cash App payment buttons (if available)',
            '   • "Tipping is always appreciated!" reminder',
            'You can pay through the app before you arrive or pay in cash at the shop.',
          ]),

          ...step('Step 5: Before Your Appointment', [
            'You\'ll receive a reminder push notification 1 hour before your appointment.',
            'To view your upcoming appointments, tap "My Appointments" in the app.',
            'You can cancel anytime by tapping "Cancel Appointment" on any upcoming booking.',
          ]),

          ...step('Step 6: After Your Appointment', [
            'Your appointment will show in your "Past Visits" section.',
            'Tap "Rebook" anytime to book again with the same barber.',
            'Your barber keeps track of your preferences, so each visit gets better!',
          ]),

          // Footer
          new Paragraph({
            spacing: { before: 600 },
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
            children: [
              new TextRun({ text: '\n\nField Manager Pro — fieldmanagerpro.app', size: 18, color: '999999', italics: true }),
            ],
          }),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="FMP_Barbershop_Setup_Guide.docx"',
    },
  })
}

function step(title: string, bullets: string[]): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 300, after: 100 },
      children: [new TextRun({ text: title, bold: true, size: 24 })],
    }),
    ...bullets.map(b => new Paragraph({
      spacing: { after: 60 },
      indent: { left: b.startsWith('   ') ? 720 : 360 },
      children: [new TextRun({ text: b.trimStart(), size: 22 })],
    })),
  ]
}
