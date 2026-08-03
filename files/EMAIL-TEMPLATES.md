# MeatScentinel — email templates

Branded replacements for Supabase's default auth emails.

Paste each into **Supabase dashboard → Authentication → Email Templates**,
selecting the matching template from the dropdown, then Save.

---

## Notes before you paste

**Inline styles only.** Email clients strip `<style>` blocks and ignore most
CSS. Everything here is inlined on the elements, which is unattractive to read
but is what actually renders.

**Tables for layout.** Outlook renders `div` layouts unpredictably. Tables are
the reliable choice in email, whatever their reputation on the web.

**The button is a table cell, not a styled link.** Outlook ignores padding on
anchors, so a padded anchor collapses to bare text. The cell carries the
padding and colour; the anchor sits inside it.

**Every template repeats the plain URL below the button.** Some clients and
corporate mail filters break or rewrite buttons, and a link nobody can click is
a support request you do not want during a demo.

**Subject lines** are set in the field above the body, not in the HTML.

---

## 1. Confirm signup

Sent when an account is created. Subject:

```
Confirm your MeatScentinel account
```

```html
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f6f2;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e3e1d9;border-radius:12px;">

        <tr>
          <td style="padding:24px 32px 20px 32px;border-bottom:1px solid #e3e1d9;">
            <p style="margin:0;font-size:15px;font-weight:600;color:#1c1c1a;">MeatScentinel</p>
            <p style="margin:2px 0 0 0;font-size:13px;color:#888780;">Inspection portal</p>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 32px;">
            <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#1c1c1a;">Confirm your account</h1>
            <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#5f5e5a;">
              An inspection portal account has been created for you. Confirm this
              address to activate it.
            </p>

            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
              <tr>
                <td style="background-color:#b62b54;border-radius:8px;">
                  <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm account</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px 0;font-size:12px;color:#888780;">
              If the button does not work, paste this into your browser:
            </p>
            <p style="margin:0;font-size:12px;word-break:break-all;">
              <a href="{{ .ConfirmationURL }}" style="color:#912243;">{{ .ConfirmationURL }}</a>
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 32px;border-top:1px solid #e3e1d9;background-color:#f7f6f2;border-radius:0 0 12px 12px;">
            <p style="margin:0 0 6px 0;font-size:12px;line-height:1.6;color:#888780;">
              You sign in with your User ID, not this email address. Your
              administrator will provide it.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#888780;">
              MeatScentinel is an assistive inspection support tool. It does not
              replace official inspection procedures, laboratory testing, or
              professional judgment.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
```

---

## 2. Reset password

Sent from the Forgot Password page. Subject:

```
Reset your MeatScentinel password
```

```html
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f6f2;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e3e1d9;border-radius:12px;">

        <tr>
          <td style="padding:24px 32px 20px 32px;border-bottom:1px solid #e3e1d9;">
            <p style="margin:0;font-size:15px;font-weight:600;color:#1c1c1a;">MeatScentinel</p>
            <p style="margin:2px 0 0 0;font-size:13px;color:#888780;">Inspection portal</p>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 32px;">
            <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#1c1c1a;">Reset your password</h1>
            <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#5f5e5a;">
              A password reset was requested for your inspection portal account.
              Choose a new password using the link below.
            </p>

            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
              <tr>
                <td style="background-color:#b62b54;border-radius:8px;">
                  <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set a new password</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px 0;font-size:12px;color:#888780;">
              If the button does not work, paste this into your browser:
            </p>
            <p style="margin:0 0 20px 0;font-size:12px;word-break:break-all;">
              <a href="{{ .ConfirmationURL }}" style="color:#912243;">{{ .ConfirmationURL }}</a>
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faeeda;border:1px solid rgba(133,79,11,0.25);border-radius:8px;">
              <tr>
                <td style="padding:12px 16px;">
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#854f0b;">
                    This link expires in one hour and can only be used once. If
                    you did not request this, no action is needed — your password
                    has not changed.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 32px;border-top:1px solid #e3e1d9;background-color:#f7f6f2;border-radius:0 0 12px 12px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#888780;">
              MeatScentinel is an assistive inspection support tool. It does not
              replace official inspection procedures, laboratory testing, or
              professional judgment.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
```

---

## 3. Change email address

Sent when a user requests an email change. With "Secure email change" enabled
this goes to both the old and new address. Subject:

```
Confirm your new MeatScentinel email address
```

```html
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f6f2;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e3e1d9;border-radius:12px;">

        <tr>
          <td style="padding:24px 32px 20px 32px;border-bottom:1px solid #e3e1d9;">
            <p style="margin:0;font-size:15px;font-weight:600;color:#1c1c1a;">MeatScentinel</p>
            <p style="margin:2px 0 0 0;font-size:13px;color:#888780;">Inspection portal</p>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 32px;">
            <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#1c1c1a;">Confirm your new email address</h1>
            <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#5f5e5a;">
              A request was made to change the recovery email on your inspection
              portal account.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background-color:#f7f6f2;border:1px solid #e3e1d9;border-radius:8px;">
              <tr>
                <td style="padding:12px 16px;">
                  <p style="margin:0 0 4px 0;font-size:12px;color:#888780;">Current address</p>
                  <p style="margin:0 0 10px 0;font-size:13px;color:#1c1c1a;">{{ .Email }}</p>
                  <p style="margin:0 0 4px 0;font-size:12px;color:#888780;">Requested address</p>
                  <p style="margin:0;font-size:13px;color:#1c1c1a;">{{ .NewEmail }}</p>
                </td>
              </tr>
            </table>

            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
              <tr>
                <td style="background-color:#b62b54;border-radius:8px;">
                  <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm change</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px 0;font-size:12px;color:#888780;">
              If the button does not work, paste this into your browser:
            </p>
            <p style="margin:0 0 20px 0;font-size:12px;word-break:break-all;">
              <a href="{{ .ConfirmationURL }}" style="color:#912243;">{{ .ConfirmationURL }}</a>
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faeeda;border:1px solid rgba(133,79,11,0.25);border-radius:8px;">
              <tr>
                <td style="padding:12px 16px;">
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#854f0b;">
                    Your address does not change until this is confirmed. Until
                    then, password reset links continue going to your current
                    address. If you did not request this, ignore this email and
                    change your password.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 32px;border-top:1px solid #e3e1d9;background-color:#f7f6f2;border-radius:0 0 12px 12px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#888780;">
              MeatScentinel is an assistive inspection support tool. It does not
              replace official inspection procedures, laboratory testing, or
              professional judgment.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
```

---

## 4. Magic link and Invite

Not used by MeatScentinel. Accounts are created by an administrator, and
sign-in is by User ID and password. Leave these at their defaults, or replace
the body with a line stating the method is not supported so an accidental send
is not confusing.

---

## Template variables

Available in these templates:

| Variable | Meaning |
|---|---|
| `{{ .ConfirmationURL }}` | The full action link |
| `{{ .Email }}` | The account's current address |
| `{{ .NewEmail }}` | The requested address (email change only) |
| `{{ .SiteURL }}` | Your configured site URL |
| `{{ .Token }}` | Six-digit code, if using OTP instead of a link |

`{{ .NewEmail }}` is only populated in the email-change template — using it
elsewhere renders blank.

---

## After pasting

Send yourself one of each and check them on a phone as well as a desktop. The
tables are set to a 520px maximum and reflow on narrow screens, but seeing it is
worth more than trusting it.

If a template fails to save, the cause is almost always a mistyped variable —
Supabase validates the Go template syntax and rejects malformed braces.
