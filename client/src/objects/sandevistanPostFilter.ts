import * as PIXI from "pixi.js-legacy";

/**
 * Sandevistan post-processing filter: chromatic-aberration-style edge shift,
 * air-refraction distortion and directional motion blur in a single pass.
 * Applied to the PIXI stage (the DOM HUD lives outside the canvas).
 *
 * pixi.js-legacy 7.4.2 quirk worked around here: per-channel sampling
 * (texture2D(...).r / .g / .b) blackens the filtered output on this renderer
 * (the grass went black), so every effect uses whole-vec4 samples plus
 * component-wise vec4 operations only.
 * The default PIXI vertex shader is used on purpose: a custom NDC vertex made
 * the filter sample only a small region of the texture, leaving the screen
 * grass-only (trees/buildings vanished).
 */
const fragment = `
precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform float uAmount;
uniform float uTime;
uniform float uChromaOn;
uniform float uDistortOn;
uniform float uBlurOn;

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 toCenter = uv - vec2(0.5);
    float dist = length(toCenter);
    float edge = smoothstep(0.22, 0.8, dist);
    float wave = sin((uv.x * 38.0 + uv.y * 26.0) + uTime * 7.0)
                + 0.5 * sin((uv.x * 17.0 - uv.y * 31.0) - uTime * 5.0);
    vec2 perp = vec2(-0.7071, 0.7071);
    vec2 distUV = clamp(
        uv + perp * wave * 0.005 * uAmount * uDistortOn * (0.35 + edge),
        0.0,
        1.0
    );
    vec2 chromaDir = normalize(toCenter + vec2(0.0001, 0.0001));
    vec2 caUV = clamp(
        distUV + chromaDir * (uAmount * uChromaOn * edge * 0.008),
        0.0,
        1.0
    );
    float strength = uAmount * uBlurOn * 0.020 * (0.45 + edge);
    vec2 nrm = vec2(0.7071, 0.7071);
    vec4 sum = texture2D(uSampler, caUV);
    sum += texture2D(uSampler, clamp(caUV + nrm * strength, 0.0, 1.0));
    sum += texture2D(uSampler, clamp(caUV - nrm * strength, 0.0, 1.0));
    vec4 col = sum * (1.0 / 3.0);

    // Cold cyber tint (component-wise vec4 multiply).
    vec4 tint = vec4(0.88, 1.04, 1.14, 1.0);
    col = mix(col, col * tint, 0.5 * uAmount);

    gl_FragColor = col;
}
`;

export class SandevistanPostFilter extends PIXI.Filter {
    private elapsed = 0;

    constructor() {
        super(undefined, fragment, {
            uAmount: 0,
            uTime: 0,
            uChromaOn: 1,
            uDistortOn: 1,
            uBlurOn: 1,
        });
    }

    /** Smoothly set the global effect strength (0 idle .. 1 fully active). */
    setAmount(amount: number, dt: number): number {
        const current = Number(this.uniforms.uAmount) || 0;
        const next = Math.max(
            0,
            Math.min(1, current + (amount - current) * Math.min(1, dt * 7)),
        );
        this.uniforms.uAmount = next;
        return next;
    }

    setToggles(chroma: boolean, distort: boolean, blur: boolean): void {
        this.uniforms.uChromaOn = chroma ? 1 : 0;
        this.uniforms.uDistortOn = distort ? 1 : 0;
        this.uniforms.uBlurOn = blur ? 1 : 0;
    }

    advance(dt: number): void {
        this.elapsed += dt;
        this.uniforms.uTime = this.elapsed;
    }
}
