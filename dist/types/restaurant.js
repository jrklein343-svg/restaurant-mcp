/**
 * Unified restaurant types for multi-platform support
 */
// Error codes
export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["RESTAURANT_NOT_FOUND"] = "RESTAURANT_NOT_FOUND";
    ErrorCode["NO_ONLINE_RESERVATIONS"] = "NO_ONLINE_RESERVATIONS";
    ErrorCode["PLATFORM_UNAVAILABLE"] = "PLATFORM_UNAVAILABLE";
    ErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
    ErrorCode["AUTH_FAILED"] = "AUTH_FAILED";
    ErrorCode["BOOKING_FAILED"] = "BOOKING_FAILED";
    ErrorCode["INVALID_DATE"] = "INVALID_DATE";
    ErrorCode["NO_AVAILABILITY"] = "NO_AVAILABILITY";
    ErrorCode["INVALID_INPUT"] = "INVALID_INPUT";
})(ErrorCode || (ErrorCode = {}));
// Custom error class
export class ReservationError extends Error {
    code;
    platform;
    suggestions;
    retryAfter;
    constructor(code, message, options) {
        super(message);
        this.name = 'ReservationError';
        this.code = code;
        this.platform = options?.platform;
        this.suggestions = options?.suggestions;
        this.retryAfter = options?.retryAfter;
    }
    toJSON() {
        return {
            error: this.code,
            message: this.message,
            platform: this.platform,
            suggestions: this.suggestions,
            retryAfter: this.retryAfter,
        };
    }
}
