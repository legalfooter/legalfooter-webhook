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
  <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 8px;">
    <img src="https://framerusercontent.com/images/MHBbgdrBWWQlb1fEzcwul4yrk.png" alt="LegalFooter Logo" style="max-width: 150px; display: block; margin: 0 0 20px 0;" />
    <h1 style="color: #007BFF;">Website Protection Activated.</h1>
    <p style="font-size: 16px;">Your website is now live with a LegalFooter—if you receive an ADA demand letter, submit it using the form below within 10 days.</p>
    <a href="https://yourdomain.com/submit-claim" style="display: inline-block; background-color: #005bbd; color: white; text-decoration: none; padding: 12px 20px; border-radius: 5px; font-weight: bold; margin: 20px 0 10px 0;">Submit Claim</a>
    <hr style="margin: 20px 0;" />
    <p><strong>Policy Number:</strong> <span style="color: #555;">\${uuid}</span></p>
    <p><strong>Protected Domain:</strong> <span style="color: #555;">\${domain}</span></p>
    <hr style="margin: 20px 0;" />
    <p style="font-size: 14px; color: #999;">Questions? Just reply to this email or visit our support center.</p>
  </div>
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
