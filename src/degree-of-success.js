/** Get the degree of success from a roll and a difficulty class */
class DegreeOfSuccess {
    value;
    unadjusted;
    adjustment;
    dieResult;
    rollTotal;
    dc;

    constructor(
        roll,
        dc,
        dosAdjustments,
    ) {
        if (roll instanceof Roll) {
            this.dieResult =
                (roll.isDeterministic
                        ? roll.terms.find((t) => t instanceof NumericTerm)
                        : roll.dice.find((d) => d instanceof Die && d.faces === 20)
                )?.total ?? 1;
            this.rollTotal = roll.total;
        } else {
            this.dieResult = roll.dieValue;
            this.rollTotal = roll.dieValue + roll.modifier;
        }

        this.dc = typeof dc === "number" ? {value: dc} : dc;

        this.unadjusted = this.#calculateDegreeOfSuccess();
        this.adjustment = this.#getDegreeAdjustment(this.unadjusted, dosAdjustments);
        this.value = this.adjustment
            ? this.#adjustDegreeOfSuccess(this.adjustment.amount, this.unadjusted)
            : this.unadjusted;
    }

    static CRITICAL_FAILURE = 0;
    static FAILURE = 1;
    static SUCCESS = 2;
    static CRITICAL_SUCCESS = 3;

    #getDegreeAdjustment(
        degree,
        adjustments,
    ) {
        if (!adjustments) return null;

        for (const outcome of ["all", ...DEGREE_OF_SUCCESS_STRINGS]) {
            const {label, amount} = adjustments[outcome] ?? {};
            if (
                amount &&
                label &&
                !(degree === DegreeOfSuccess.CRITICAL_SUCCESS && amount === 1) &&
                !(degree === DegreeOfSuccess.CRITICAL_FAILURE && amount === -1) &&
                (outcome === "all" || DEGREE_OF_SUCCESS_STRINGS.indexOf(outcome) === degree)
            ) {
                return {label, amount};
            }
        }

        return null;
    }

    #adjustDegreeOfSuccess(
        amount,
        degreeOfSuccess,
    ) {
        switch (amount) {
            case "criticalFailure":
                return 0;
            case "failure":
                return 1;
            case "success":
                return 2;
            case "criticalSuccess":
                return 3;
            default:
                return Math.clamped(degreeOfSuccess + amount, 0, 3);
        }
    }

    /**
     * @param degree The current success value
     * @return The new success value
     */
    #adjustDegreeByDieValue(degree) {
        if (this.dieResult === 20) {
            return this.#adjustDegreeOfSuccess(1, degree);
        } else if (this.dieResult === 1) {
            return this.#adjustDegreeOfSuccess(-1, degree);
        }

        return degree;
    }

    #calculateDegreeOfSuccess() {
        const dc = this.dc.value;

        if (this.rollTotal - dc >= 10) {
            return this.#adjustDegreeByDieValue(DegreeOfSuccess.CRITICAL_SUCCESS);
        } else if (dc - this.rollTotal >= 10) {
            return this.#adjustDegreeByDieValue(DegreeOfSuccess.CRITICAL_FAILURE);
        } else if (this.rollTotal >= dc) {
            return this.#adjustDegreeByDieValue(DegreeOfSuccess.SUCCESS);
        }

        return this.#adjustDegreeByDieValue(DegreeOfSuccess.FAILURE);
    }
}

const DEGREE_OF_SUCCESS_STRINGS = ["criticalFailure", "failure", "success", "criticalSuccess"];
