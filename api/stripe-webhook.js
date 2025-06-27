import { buffer } from 'micro';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

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
    const policy_id = session.id;

    const { data, error } = await supabase
      .from('legalfooter_policies')
      .insert([
        {
          email,
          domain,
          stripe_customer_id: session.customer,
          policy_id,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error.message);
    } else {
      console.log('✅ Email about to be sent to:', email);

      const uuid = data?.id;

      try {
        const emailResponse = await resend.emails.send({
          from: 'LegalFooter <onboarding@resend.dev>',
          to: [email],
          subject: 'Your LegalFooter Policy is Active',
          html: `
            <h1>Welcome to LegalFooter</h1>
            <p><strong>Policy Number:</strong> ${uuid}</p>
            <p><strong>Protected Domain:</strong> ${domain}</p>
            <p>Thank you for securing your business with us. Your protection is now active.</p>
          `
        });

        console.log('✅ Resend email response:', emailResponse);
      } catch (emailErr) {
        console.error('❌ Email sending error:', emailErr);
      }
    }
  }

  res.status(200).json({ received: true });
}
