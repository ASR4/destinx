import type { BookingSummary } from '../../types/booking.js';

export function buildBookingConfirmationPrompt(
  summary: BookingSummary,
  provider: string,
): string {
  return `Generate a WhatsApp message confirming the following booking details. The user needs to review and approve before we proceed.

## Booking Summary
- Provider: ${provider}
${summary.hotelName ? `- Hotel: ${summary.hotelName}` : ''}
${summary.flightNumber ? `- Flight: ${summary.flightNumber}` : ''}
${summary.checkIn ? `- Check-in: ${summary.checkIn}` : ''}
${summary.checkOut ? `- Check-out: ${summary.checkOut}` : ''}
${summary.roomType ? `- Room: ${summary.roomType}` : ''}
${summary.totalPrice ? `- Total: ${summary.totalPrice}` : ''}
${summary.loyaltyPoints ? `- Points earned: ${summary.loyaltyPoints}` : ''}
${summary.cancellationPolicy ? `- Cancellation: ${summary.cancellationPolicy}` : ''}

## Format
- Use WhatsApp-friendly formatting (*bold*, line breaks)
- Include relevant emoji
- End with a clear call-to-action: tell the user to tap "Confirm Booking" in the browser window
- Keep it concise (under 200 words)
`;
}
