import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const domain = session.custom_fields?.find(f => f.key === 'protecteddomain')?.text?.value;

    const { error } = await supabase.from('legalfooter_policies').insert([
      {
        email,
        domain,
        stripe_customer_id: session.customer,
        policy_id: session.id,
      }
    ]);

    if (error) {
      console.error('Supabase insert error:', error.message);
    }

  // Send confirmation email via Resend
    await resend.emails.send({
      from: 'LegalFooter <onboarding@resend.dev>',
      to: email,
      subject: 'Your LegalFooter Policy is Active',
      html: `
        <h2>Welcome to LegalFooter</h2>
        <p>Thank you for protecting your website.</p>
        <ul>
          <li><strong>Domain:</strong> ${domain}</li>
          <li><strong>Policy Number:</strong> LFP-${policyId}</li>
        </ul>
        <p>If you have any questions, just reply to this email.</p>
      `,
    });
  }

  res.status(200).json({ received: true });
}
