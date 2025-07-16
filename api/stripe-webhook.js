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
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
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
          from: 'LegalFooter <donotreply@legalfooter.com>',
          to: [email],
          subject: '🔒 Your website is protected with a LegalFooter.',
html: `
  <div style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 30px 0;">
    <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.05);">
      <img src="https://framerusercontent.com/images/MHBbgdrBWWQlb1fEzcwul4yrk.png" alt="LegalFooter Logo" style="max-width: 150px; display: block; margin: 0 0 20px 0;" />

      <h1 style="color: #005bbd; text-align: left;">Your LegalFooter Support is Active.</h1>
      
      <p style="font-size: 16px; color: #333; text-align: left;">Your LegalFooter ADA Website Support Plan™ is now active.</p>

      <div style="font-size: 15px; color: #333; margin: 20px 0;">
        <p><strong>Plan ID:</strong> ${uuid}</p>
        <p><strong>Protected URL:</strong> ${domain}</p>
        <p><strong>Plan Details:</strong> Each plan includes legal response and website fixes if you receive an ADA demand letter during your coverage period.</p>
        <p><strong>What's Included:</strong><br />
        – Legal response drafted by ADA-specialized attorney<br />
        – ADA developer fixes using WCAG 2.2 guidelines<br />
        – Access to experts to reduce risk of legal escalation</p>
      </div>

      <a href="https://calendly.com/legalfooter-support/30min" style="display: block; width: 100%; text-align: center; background-color: #005bbd; color: white; padding: 14px 20px; text-decoration: none; font-weight: bold; border-radius: 5px; margin: 25px 0;">Submit Demand Letter</a>

      <p style="font-size: 14px; color: #777; margin: 30px 0 0;">🕐 <strong>Important:</strong> You must submit your ADA demand letter within <strong>72 hours</strong> of receipt to remain eligible for coverage.</p>

      <hr style="margin: 30px 0;" />

      <p style="font-size: 13px; color: #888;">
        💬 Have questions? Contact our support team at <a href="mailto:support@legalfooter.com" style="color: #888; text-decoration: underline;">support@legalfooter.com</a>
      </p>

      <p style="font-size: 13px; color: #888; text-align: center; margin-top: 40px;">
        <a href="https://docs.google.com/document/d/1gG2cnLJLm4EWd2PukNamQloRv3WKfkUEhN2ksVYuEoY/edit?usp=sharing" style="color: #888; text-decoration: underline;">Privacy Policy</a> &nbsp;|&nbsp;
        <a href="https://docs.google.com/document/d/1e-g4BL-KR1N9iDHII0hZcU9EXST2VxM7bHETD4w9gG8/edit?usp=sharing" style="color: #888; text-decoration: underline;">Terms of Service</a>
      </p>
    </div>
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
