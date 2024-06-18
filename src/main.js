const moduleName = "pf2e-weapon-trait-options";

const wordCharacter = String.raw`[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`;
const nonWordCharacter = String.raw`[^\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`;
const nonWordCharacterRE = new RegExp(nonWordCharacter, "gu");

const wordBoundary = String.raw`(?:${wordCharacter})(?=${nonWordCharacter})|(?:${nonWordCharacter})(?=${wordCharacter})`;
const nonWordBoundary = String.raw`(?:${wordCharacter})(?=${wordCharacter})`;
const lowerCaseLetter = String.raw`\p{Lowercase_Letter}`;
const upperCaseLetter = String.raw`\p{Uppercase_Letter}`;
const lowerCaseThenUpperCaseRE = new RegExp(`(${lowerCaseLetter})(${upperCaseLetter}${nonWordBoundary})`, "gu");

const nonWordCharacterHyphenOrSpaceRE = /[^-\p{White_Space}\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]/gu;
const upperOrWordBoundariedLowerRE = new RegExp(`${upperCaseLetter}|(?:${wordBoundary})${lowerCaseLetter}`, "gu");


// Backswing
// sweep
Hooks.on("renderChatMessage", async (message, html) => {
    if (message.flags?.pf2e?.context?.type != 'attack-roll') {return}

    let buttons = []
    let _ignore = (message.getFlag(moduleName, 'ignore') ?? [])

    addButton(message, _ignore, buttons, "backswing");
    addButton(message, _ignore, buttons, "sweep");

    if (buttons.length > 0) {
        html.find('.message-buttons').after(`<div class='traits-buttons'></div>`)
        html.find('.traits-buttons').append(buttons)
    }
});

// forcefull
Hooks.on("renderChatMessage", async (message, html) => {
    if (message.flags?.pf2e?.context?.type != 'damage-roll') {return}

    let buttons = []
    let _ignore = (message.getFlag(moduleName, 'ignore') ?? [])

    if (message.flags.pf2e?.context?.mapIncreases || message.flags.pf2e?.context?.options?.includes('map:increases:1') || message.flags.pf2e?.context?.options?.includes('map:increases:2')) {
        if (message.item?.system?.traits?.value?.includes('forceful')
            && !message.flags.pf2e.modifiers.find(a=>a.slug==='forceful-second' && a.enabled)
            && !message.flags.pf2e.modifiers.find(a=>a.slug==='forceful-third' && a.enabled)
            && !_ignore.includes(name)
        ) {
            addDamageButton(message, _ignore, buttons, addForceful, 'forceful');
        }
    }

    if (buttons.length > 0) {
        html.find('.damage-application').first().before(`<div class='traits-buttons'></div>`)
        html.find('.traits-buttons').append(buttons)
    }
});

function addButton(message, _ignore, buttons, name) {
    if (message.item?.system?.traits?.value?.includes(name) && !message.flags.pf2e.modifiers.find(a=>a.slug===name && a.enabled) && !_ignore.includes(name)) {
        let button = $(`<button class="${name}" data-tooltip="PF2E.TraitDescription${name.split('-')[0].capitalize()}">Apply ${name.capitalize()}</button>`)
        button.click((e) => rollLogic(e, message, _ignore, name));
        buttons.push(button);
    }
}

function addDamageButton(message, _ignore, buttons, callBtn, name) {
    let button = $(`<button class="${name}" data-tooltip="PF2E.TraitDescription${name.split('-')[0].capitalize()}">Apply ${name.capitalize()}</button>`)
    button.click((e) => callBtn(e, message, _ignore));
    buttons.push(button);
}

async function addForceful(event, message, _ignore) {
    let systemFlags = message.flags.pf2e;
    let traitName = systemFlags.context.options.includes("map:increases:1") ?  "forceful-second" : "forceful-third";
    let mods = [...systemFlags.modifiers];

    let _e = mods.find(a=>a.slug===traitName);
    _e.enabled = true;
    _e.ignored = false;

    let roll = message.rolls[0];
    let isCrit = roll?.options?.degreeOfSuccess === 3;

    roll.options.damage.damage.modifiers.find(a=>a.slug===traitName).ignored = false;
    roll.options.damage.damage.modifiers.find(a=>a.slug===traitName).enabled = true;
    roll.options.damage.modifiers.find(a=>a.slug===traitName).ignored = false;
    roll.options.damage.modifiers.find(a=>a.slug===traitName).enabled = true;

    let newMod = new game.pf2e.StatisticModifier(message.flags.pf2e.modifierName, roll.options.damage.damage.modifiers.filter(m=>!m.damageType || m.damageType === 'slashing'));

    let base = roll.terms[0].rolls[0];
    let baseTerms = isCrit
        ? (base.terms[0].term.operands.find(a=>a.constructor.name === 'Grouping') ?? base.terms[0].term.operands.find(a=>a.constructor.name === 'ArithmeticExpression')?.operands?.find(a=>a.constructor.name === 'Grouping') )
        : base.terms[0];

    if (baseTerms.constructor.name === "Grouping") {
        let ae = baseTerms.term.operands.find(a=>a.constructor.name === 'ArithmeticExpression')
        let insideNumber = baseTerms.term.operands.find(a=>a instanceof NumericTerm)
        if (ae) {
            let nValue = ae.operands.find(a=>a instanceof NumericTerm);
            if (nValue) {
                nValue.number = newMod.totalModifier;
                nValue._evaluated = false
                nValue.evaluate()
            }
            ae._evaluated = false
            ae.evaluate()
        } else if (insideNumber) {
            insideNumber.number = newMod.totalModifier;
            insideNumber._evaluated = false
            insideNumber.evaluate()
        }

        baseTerms._evaluated = false
        baseTerms.evaluate()
    } else if (baseTerms instanceof NumericTerm) {
        baseTerms.number = newMod.totalModifier;
    }
    base._evaluated = false
    base.resetFormula()
    base._total = base?._evaluateTotal() ?? base._total;
    base.evaluate()

    roll.terms[0].results = roll.terms[0].rolls.map(a=> { return { active: true, result: a.total } } )
    roll.terms[0].terms = roll.terms[0].rolls.map((r) => r._formula)

    roll._evaluated = false
    roll.resetFormula()
    roll.evaluate()

    _ignore.push(traitName);
    await message.update({
        'rolls': [roll],
        content: `${roll.total}`,
        flags: {
            pf2e: systemFlags,
            [moduleName]: {
                'ignore': _ignore
            }
        },
    });
}

async function rollLogic(event, message, _ignore, traitName) {
    let systemFlags = message.flags.pf2e;
    let mods = [...systemFlags.modifiers];

    let _e = mods.find(a=>a.slug===traitName);
    _e.enabled = true;
    _e.ignored = false;

    let newMod = new game.pf2e.StatisticModifier(message.flags.pf2e.modifierName, mods);

    let roll = message.rolls[0];
    let n = roll.terms.find(a=>a instanceof NumericTerm);
    if (n) {
        n.number = newMod.totalModifier
    } else {
        roll.terms.push(new OperatorTerm({operator:"+"}))
        roll.terms.push(new NumericTerm({number: newMod.totalModifier}))
    }
    roll._evaluated = false
    roll.options.totalModifier = newMod.totalModifier;

    roll.resetFormula()
    roll.evaluate()

    let context = systemFlags.context;
    context.options.push(traitName+'-bonus');

    const substitutions = (context.substitutions ??= []);
    const requiredSubstitution = context.substitutions.find((s) => s.required && s.selected);
    if (requiredSubstitution) {
        for (const substitution of context.substitutions) {
            substitution.required = substitution === requiredSubstitution;
            substitution.selected = substitution === requiredSubstitution;
        }
    }

    let extraTags = []
    const rollOptions = context.options ? new Set(context.options): new Set();

    const tagsFromDice = (() => {
        const substitution = substitutions.find((s) => s.selected);
        const rollTwice = context.rollTwice ?? false;

        // Determine whether both fortune and misfortune apply to the check
        const fortuneMisfortune = new Set(
            [
                substitution?.effectType,
                rollTwice === "keep-higher" ? "fortune" : rollTwice === "keep-lower" ? "misfortune" : null,
            ].filter(a=>a),
        );
        for (const trait of fortuneMisfortune) {
            rollOptions.add(trait);
        }

        if (rollOptions.has("fortune") && rollOptions.has("misfortune")) {
            for (const sub of substitutions) {
                // Cancel all roll substitutions and recalculate
                rollOptions.delete(`substitute:${sub.slug}`);
            }

            return ["PF2E.TraitFortune", "PF2E.TraitMisfortune"];
        } else if (substitution) {
            const effectType = {
                fortune: "PF2E.TraitFortune",
                misfortune: "PF2E.TraitMisfortune",
            }[substitution.effectType];
            const extraTag = game.i18n.format("PF2E.SpecificRule.SubstituteRoll.EffectType", {
                type: game.i18n.localize(effectType),
                substitution: reduceItemName(game.i18n.localize(substitution.label)),
            });

            return [extraTag];
        } else if (context.rollTwice === "keep-lower") {
            return ["PF2E.TraitMisfortune"];
        } else if (context.rollTwice === "keep-higher") {
            return ["PF2E.TraitFortune"];
        } else {
            return [];
        }
    })();
    extraTags.push(...tagsFromDice);

    const dosAdjustments = (() => {
        if (context.dc === null || context.dc === undefined) return {};

        const naturalTotal = roll.dice.map((d) => d.results.find((r) => r.active && !r.discarded)?.result ?? null).filter(a=>a).shift();
        const temporaryRollOptions = new Set([
            ...rollOptions,
            `check:total:${roll.total}`,
            `check:total:natural:${naturalTotal}`,
        ]);

        return preDosAdjustments(new Set(message.flags.pf2e.context.options), message.actor, message.flags.pf2e.context.domains)
            ?.filter((a) => a.predicate?.test(temporaryRollOptions) ?? true)
            .reduce((record, data) => {
                for (const outcome of ["all", ...DEGREE_OF_SUCCESS_STRINGS]) {
                    if (data.adjustments[outcome]) {
                        record[outcome] = deepClone(data.adjustments[outcome]);
                    }
                }
                return record;
            }, {}) ?? {};
    })();

    const degree = context.dc ? new DegreeOfSuccess(roll, context?.dc, dosAdjustments) : null;
    if (degree) {
        context.outcome = DEGREE_OF_SUCCESS_STRINGS[degree.value];
        context.unadjustedOutcome = DEGREE_OF_SUCCESS_STRINGS[degree.unadjusted];
        roll.options.degreeOfSuccess = degree.value;
    }

    const notesList = createHTMLElement("ul", {
        classes: ["notes"],
        children: message.flags.pf2e.context.notes.flatMap((n) => ["\n", noteToHTML(n)]).slice(1),
    })

    const newFlavor = await (async () => {
        const result = await createResultFlavor({ degree, target: message.target ?? null });

        const item = message.item ?? (await fromUuid(message?.flags?.pf2e?.origin?.uuid));

        const tags = createTagFlavor({ _modifiers: newMod.modifiers, traits: context.traits, item , type:message.flags.pf2e.context.type, extraTags });
        const title = (context.title ?? "check.slug").trim();
        const header = title.startsWith("<h4")
            ? title
            : (() => {
                  const strong = document.createElement("strong");
                  strong.innerHTML = title;
                  return createHTMLElement("h4", { classes: ["action"], children: [strong] });
              })();

        return [header, result ?? [], tags, notesList]
            .flat()
            .map((e) => (typeof e === "string" ? e : e.outerHTML))
            .join("");
    })();

    _ignore.push(traitName);
    delete context.dc;

    await message.update({
        'rolls': [roll],
        content: `${roll.total}`,
        flavor: `${newFlavor}`,
        speaker: message.speaker,
        flags: {
            pf2e: systemFlags,
            [moduleName]: {
                'ignore': _ignore
            }
        },
    });

    console.log(`${traitName} was added`)
}

function sluggify(text, { camel = null } = {})  {
    // Sanity check
    if (typeof text !== "string") {
        console.warn("Non-string argument passed to `sluggify`");
        return "";
    }

    // A hyphen by its lonesome would be wiped: return it as-is
    if (text === "-") return text;

    switch (camel) {
        case null:
            return text
                .replace(lowerCaseThenUpperCaseRE, "$1-$2")
                .toLowerCase()
                .replace(/['’]/g, "")
                .replace(nonWordCharacterRE, " ")
                .trim()
                .replace(/[-\s]+/g, "-");
        case "bactrian": {
            const dromedary = sluggify(text, { camel: "dromedary" });
            return dromedary.charAt(0).toUpperCase() + dromedary.slice(1);
        }
        case "dromedary":
            return text
                .replace(nonWordCharacterHyphenOrSpaceRE, "")
                .replace(/[-_]+/g, " ")
                .replace(upperOrWordBoundariedLowerRE, (part, index) =>
                    index === 0 ? part.toLowerCase() : part.toUpperCase(),
                )
                .replace(/\s+/g, "");
        default:
            throw ErrorPF2e("I don't think that's a real camel.");
    }
}

function parseHTML(unparsed) {
    const fragment = document.createElement("template");
    fragment.innerHTML = unparsed;
    const element = fragment.content.firstElementChild;
    if (!(element instanceof HTMLElement)) throw ErrorPF2e("Unexpected error parsing HTML");

    return element;
}

function reduceItemName(label) {
    return label.includes(":") ? label.replace(/^[^:]+:\s*|\s*\([^)]+\)$/g, "") : label;
}

function preDosAdjustments(options, selfActor, domains) {
    const dosAdjustments = extractDegreeOfSuccessAdjustments(selfActor.synthetics, domains);

    // Handle special case of incapacitation trait
    if ((options.has("incapacitation") || options.has("item:trait:incapacitation")) && dc) {
        const effectLevel = item?.isOfType("spell")
            ? 2 * item.rank
            : item?.isOfType("physical")
            ? item.level
            : origin?.level ?? selfActor.level;

        const amount =
            this.type === "saving-throw" && selfActor.level > effectLevel
                ? DEGREE_ADJUSTMENT_AMOUNTS.INCREASE
                : !!targetActor &&
                  targetActor.level > effectLevel &&
                  ["attack-roll", "spell-attack-roll", "skill-check"].includes(this.type)
                ? DEGREE_ADJUSTMENT_AMOUNTS.LOWER
                : null;

        if (amount) {
            dosAdjustments.push({
                adjustments: {
                    all: {
                        label: "PF2E.TraitIncapacitation",
                        amount,
                    },
                },
            });
        }
    }
    return dosAdjustments;
}

function extractDegreeOfSuccessAdjustments(synthetics, selectors) {
    return Object.values(pick(synthetics.degreeOfSuccessAdjustments, selectors)).flat();
}

function pick(obj, keys){
    return [...keys].reduce(
        (result, key) => {
            if (key in obj) {
                result[key] = obj[key];
            }
            return result;
        },
        {},
    );
}

async function createResultFlavor({ degree, target }) {
    if (!degree) return null;

    const { dc } = degree;
    const needsDCParam = !!dc.label && Number.isInteger(dc.value) && !dc.label.includes("{dc}");
    const customLabel =
        needsDCParam && dc.label ? `<dc>${game.i18n.localize(dc.label)}: {dc}</dc>` : dc.label ?? null;

    const targetActor = await (async ()=> {
        if (!target?.actor) return null;
        if (target.actor instanceof CONFIG.Actor.documentClass) return target.actor;

        // This is a context flag: get the actor via UUID
        const maybeActor = await fromUuid(target.actor);
        return maybeActor instanceof CONFIG.Actor.documentClass
            ? maybeActor
            : maybeActor instanceof CONFIG.Token.documentClass
            ? maybeActor.actor
            : null;
    })();

    // Not actually included in the template, but used for creating other template data
    const targetData = await (async () => {
        if (!target) return null;

        const token = await (async ()=> {
            if (!target.token) return null;
            if (target.token instanceof CONFIG.Token.documentClass) return target.token;
            if (targetActor?.token) return targetActor.token;

            // This is from a context flag: get the actor via UUID
            return fromUuid(target.token) ;
        })();

        const canSeeTokenName = (token ?? new CONFIG.Token.documentClass(targetActor?.prototypeToken.toObject() ?? {}))
            .playersCanSeeName;
        const canSeeName = canSeeTokenName || !game.settings.get("pf2e", "metagame_tokenSetsNameVisibility");

        return {
            name: token?.name ?? targetActor?.name ?? "",
            visible: !!canSeeName,
        };
    })();

    const { checkDCs } = CONFIG.PF2E;

    // DC, circumstance adjustments, and the target's name
    const dcData = (() => {
        const dcSlug =
            dc.slug ?? (dc?.statistic?.parent?.slug ? dc.statistic.parent.slug : null);
        const dcType = game.i18n.localize(
            dc.label?.trim() ||
                game.i18n.localize(
                    dcSlug in checkDCs.Specific ? checkDCs.Specific[dcSlug] : checkDCs.Unspecific,
                ),
        );

        // Get any circumstance penalties or bonuses to the target's DC
        const circumstances =
            dc?.statistic && "modifiers" in dc.statistic
                ? dc.statistic.modifiers.filter((m) => m.enabled && m.type === "circumstance")
                : [];
        const preadjustedDC =
            circumstances.length > 0 && dc.statistic
                ? dc.value - circumstances.reduce((total, c) => total + c.modifier, 0)
                : dc.value ?? null;

        const visible = targetActor?.hasPlayerOwner || dc.visible || game.settings.get("pf2e", "metagame_showDC");

        if (typeof preadjustedDC !== "number" || circumstances.length === 0) {
            const labelKey = game.i18n.localize(
                targetData ? checkDCs.Label.WithTarget : customLabel ?? checkDCs.Label.NoTarget,
            );
            const markup = game.i18n.format(labelKey, { dcType, dc: dc.value, target: targetData?.name ?? null });

            return { markup, visible };
        }

        const adjustment = {
            preadjusted: preadjustedDC,
            direction:
                preadjustedDC < dc.value ? "increased" : preadjustedDC > dc.value ? "decreased" : "no-change",
            circumstances: circumstances.map((c) => ({ label: c.label, value: c.modifier })),
        };

        // If the adjustment direction is "no-change", the bonuses and penalties summed to zero
        const translation =
            adjustment.direction === "no-change" ? checkDCs.Label.NoChangeTarget : checkDCs.Label.AdjustedTarget;

        const markup = game.i18n.format(translation, {
            target: targetData?.name ?? game.user.name,
            dcType,
            preadjusted: preadjustedDC,
            adjusted: dc.value,
        });

        return { markup, visible, adjustment };
    })();

    // The result: degree of success (with adjustment if applicable) and visibility setting
    const resultData = (() => {
        const offset = {
            value: new Intl.NumberFormat(game.i18n.lang, {
                maximumFractionDigits: 0,
                signDisplay: "always",
                useGrouping: false,
            }).format(degree.rollTotal - dc.value),
            visible: dc.visible,
        };

        const locPath = (dosKey) => `PF2E.Check.Result.Degree.Attack.${dosKey}`;
        const unadjusted = game.i18n.localize(locPath(DEGREE_OF_SUCCESS_STRINGS[degree.unadjusted]));
        const [adjusted, locKey] = degree.adjustment
            ? [game.i18n.localize(locPath(DEGREE_OF_SUCCESS_STRINGS[degree.value])), "AdjustedLabel"]
            : [unadjusted, "Label"];

        const markup = game.i18n.format(`PF2E.Check.Result.${locKey}`, {
            adjusted,
            unadjusted,
            offset: offset.value,
        });
        const visible = game.settings.get("pf2e", "metagame_showResults");

        return { markup, visible };
    })();

    // Render the template and replace quasi-XML nodes with visibility-data-containing HTML elements
    const rendered = await renderTemplate("systems/pf2e/templates/chat/check/target-dc-result.hbs", {
        dc: dcData,
        result: resultData,
    });

    const html = parseHTML(rendered);
    const { convertXMLNode } = game.pf2e.TextEditor;

    if (targetData) {
        convertXMLNode(html, "target", { visible: targetData.visible, whose: "target" });
    }
    convertXMLNode(html, "dc", { visible: dcData.visible, whose: "target" });
    if (dcData.adjustment) {
        const { adjustment } = dcData;
        convertXMLNode(html, "preadjusted", { classes: ["unadjusted"] });

        // Add circumstance bonuses/penalties for tooltip content
        const adjustedNode = convertXMLNode(html, "adjusted", {
            classes: ["adjusted", adjustment.direction],
        });
        if (!adjustedNode) throw ErrorPF2e("Unexpected error processing roll template");

        if (adjustment.circumstances.length > 0) {
            adjustedNode.dataset.tooltip = adjustment.circumstances
                .map(
                    (a) =>
                        createHTMLElement("div", { children: [`${a.label}: ${signedInteger(a.value)}`] }).outerHTML,
                )
                .join("\n");
        }
    }
    convertXMLNode(html, "unadjusted", {
        visible: resultData.visible,
        classes: degree.adjustment ? ["unadjusted"] : [DEGREE_OF_SUCCESS_STRINGS[degree.value]],
    });
    if (degree.adjustment) {
        const adjustedNode = convertXMLNode(html, "adjusted", {
            visible: resultData.visible,
            classes: [DEGREE_OF_SUCCESS_STRINGS[degree.value], "adjusted"],
        });
        if (!adjustedNode) throw ErrorPF2e("Unexpected error processing roll template");
        adjustedNode.dataset.tooltip = degree.adjustment.label;
    }

    convertXMLNode(html, "offset", { visible: dcData.visible, whose: "target" });

    // If target and DC are both hidden from view, hide both
    if (!targetData?.visible && !dcData.visible) {
        const targetDC = html.querySelector<HTMLElement>(".target-dc");
        if (targetDC) targetDC.dataset.visibility = "gm";

        // If result is also hidden, hide everything
        if (!resultData.visible) {
            html.dataset.visibility = "gm";
        }
    }

    return html;
}

function createTagFlavor({ _modifiers, traits, item, type, extraTags }) {
    const toTagElement = (tag, cssClass = null) => {
        const span = document.createElement("span");
        span.classList.add("tag");
        if (cssClass) span.classList.add(`tag_${cssClass}`);

        span.innerText = tag.label;

        if (tag.name) span.dataset.slug = tag.name;
        if (tag.description) span.dataset.tooltip = tag.description;

        return span;
    };

    const cTraits =
            (traits?.map((t) => traitSlugToObject(t, CONFIG.PF2E.actionTraits))?.map((trait) => {
                trait.label = game.i18n.localize(trait.label);
                return trait;
            }) ?? new Set())
            .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
            .map((t) => toTagElement(t)) ?? [];

    const itemTraits =
        item?.isOfType("weapon", "melee") && type !== "saving-throw"
            ? Array.from(item.traits)
                  .map((t) => {
                      const obj = traitSlugToObject(t, CONFIG.PF2E.npcAttackTraits);
                      obj.label = game.i18n.localize(obj.label);
                      return obj;
                  })
                  .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
                  .map((t) => toTagElement(t, "alt"))
            : [];

    const properties = (() => {
        const range = item?.isOfType("action", "weapon") ? item.range : null;
        const label = createActionRangeLabel(range);
        if (label && (range?.increment || range?.max)) {
            // Show the range increment or max range as a tag
            const slug = range.increment ? `range-increment-${range.increment}` : `range-${range.max}`;
            const description = "PF2E.Item.Weapon.RangeIncrementN.Hint";
            return [toTagElement({ name: slug, label, description }, "secondary")];
        } else {
            return [];
        }
    })();

    const traitsAndProperties = createHTMLElement("div", {
        classes: ["tags", "traits"],
        dataset: { tooltipClass: "pf2e" },
    });
    if (itemTraits.length === 0 && properties.length === 0) {
        traitsAndProperties.append(...cTraits);
    } else {
        const verticalBar = document.createElement("hr");
        verticalBar.className = "vr";
        traitsAndProperties.append(...[cTraits, verticalBar, itemTraits, properties].flat());
    }

    const modifiers = _modifiers
        .filter((m) => m.enabled)
        .map((modifier) => {
            const sign = modifier.modifier < 0 ? "" : "+";
            const label = `${modifier.label} ${sign}${modifier.modifier}`;
            return toTagElement({ name: modifier.slug, label }, "transparent");
        });
    const tagsFromOptions = extraTags.map((t) => toTagElement({ label: game.i18n.localize(t) }, "transparent"));
    const modifiersAndExtras = createHTMLElement("div", {
        classes: ["tags", "modifiers"],
        children: [...modifiers, ...tagsFromOptions],
    });

    return [
        traitsAndProperties.childElementCount > 0 ? traitsAndProperties : null,
        document.createElement("hr"),
        modifiersAndExtras,
    ].filter(a=>a);
}

function createActionRangeLabel(range) {
    if (!range?.max) return null;
    const [key, value] = range.increment
        ? ["PF2E.Action.Range.IncrementN", range.increment]
        : ["PF2E.Action.Range.MaxN", range.max];

    return game.i18n.format(key, { n: value });
}

function createHTMLElement(nodeName, { classes = [], dataset = {}, children = [], innerHTML } = {},) {
    const element = document.createElement(nodeName);
    if (classes.length > 0) element.classList.add(...classes);

    for (const [key, value] of Object.entries(dataset).filter(([, v]) => !(v === null || v === undefined))) {
        element.dataset[key] = String(value);
    }

    if (innerHTML) {
        element.innerHTML = innerHTML;
    } else {
        for (const child of children) {
            const childElement = child instanceof HTMLElement ? child : new Text(child);
            element.appendChild(childElement);
        }
    }

    return element;
}

function noteToHTML(n) {
    const element = createHTMLElement("li", {
        classes: ["roll-note"],
        dataset: {
            itemId: n.rule?.item.id,
            visibility: n.visibility,
        },
        innerHTML: game.i18n.localize(n.text),
    });

    // Remove wrapping elements, such as from item descriptions
    if (element.childNodes.length === 1 && element.firstChild instanceof HTMLElement) {
        element.innerHTML = element.firstChild.innerHTML;
    }

    if (n.title) {
        const strong = createHTMLElement("strong", { innerHTML: game.i18n.localize(n.title) });
        element.prepend(strong, " ");
    }

    return element;
}

function traitSlugToObject(trait, dictionary) {
    const traitObject = {
        name: trait,
        label: game.i18n.localize(dictionary[trait] ?? trait),
    };
    if (trait in CONFIG.PF2E.traitsDescriptions) {
        traitObject.description = CONFIG.PF2E.traitsDescriptions[trait];
    }

    return traitObject;
}

function signedInteger(value, { emptyStringZero = false } = {}) {
    if (value === 0 && emptyStringZero) return "";

    const nf = (new Intl.NumberFormat(game.i18n.lang, {
        maximumFractionDigits: 0,
        signDisplay: "always",
    }));
    return nf.format(value);
}

function adjustDegreeByDieValue(dieResult, degree) {
    if (dieResult === 20) {
        return Math.clamped(degree + 1, 0, 3);
    } else if (dieResult === 1) {
        return Math.clamped(degree - 1, 0, 3);
    }
    return Math.clamped(degree, 0, 3);
}

function calculateDegreeOfSuccess(dc, rollTotal, dieResult) {
    if (rollTotal - dc >= 10) {
        return adjustDegreeByDieValue(dieResult, 3);
    } else if (dc - rollTotal >= 10) {
        return adjustDegreeByDieValue(dieResult, 0);
    } else if (rollTotal >= dc) {
        return adjustDegreeByDieValue(dieResult, 2);
    }
    return adjustDegreeByDieValue(dieResult, 1);
}

function anyFailureMessageOutcome(message) {
    return failureMessageOutcome(message) || criticalFailureMessageOutcome(message);
}

function failureMessageOutcome(message) {
    return "failure" === message?.flags?.pf2e?.context?.outcome;
}

function criticalFailureMessageOutcome(message) {
    return "criticalFailure" === message?.flags?.pf2e?.context?.outcome;
}


function isCorrectMessageType(message, type) {
    if (type === "undefined") {
        return undefined === message?.flags?.pf2e?.context?.type;
    }
    return type === message?.flags?.pf2e?.context?.type;
}

async function nudgeFate(message) {
    if (!game.user.isGM) {return}
    if (!anyFailureMessageOutcome(message)) {return}
    if (isCorrectMessageType(message, "saving-throw")
        || isCorrectMessageType(message, "attack-roll")
        || isCorrectMessageType(message, "skill-check")
    ) {
        if (!message.flags.pf2e.modifiers.find(a=>a.slug==='nudge-fate')) {return}

        const rr = message.rolls[0];
        let dc = message?.flags?.pf2e?.context?.dc.value
        if (!dc || !rr) {return}

        const newR = calculateDegreeOfSuccess(dc, rr._total + 1, rr.dice[0].total)
        if (rr.degreeOfSuccess !== newR) {
            rollLogic({}, message, [], 'nudge-fate')
            ui.notifications.info(`Nudge Fate effect was activated`);
            message.actor.itemTypes.effect.find((a) => a.slug === "effect-nudge-fate")?.delete()
        }
    }
};

Hooks.on("createChatMessage", async (message, user, _options, userId) => {
    await nudgeFate(message)
});