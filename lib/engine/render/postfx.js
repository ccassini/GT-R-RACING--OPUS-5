// ═══════════════════════════════════════════════════════
//  POST FX — restrained teal/amber grade with vignette,
//  grain and edge chroma. Lamps stay defined; no bloom pass.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { orderedPostFxPasses } from './runtimeQuality.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.06 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.035 },
    uChroma: { value: 0.5 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec3  uLift;
    uniform vec3  uGain;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uFlash;
    uniform vec3  uFlashColor;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Lateral chromatic aberration, edges only.
      vec2 offset = centered * r2 * 0.006 * uChroma;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + offset).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - offset).b;

      // Lift shadows toward the cool end, gain highlights toward warm.
      col = col * uGain + uLift * (1.0 - col);

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;

      col *= 1.0 - uVignette * smoothstep(0.18, 0.78, r2);

      float grain = hash(vUv * vec2(1024.0, 768.0) + fract(uTime) * 91.7) - 0.5;
      col += grain * uGrain * (1.25 - luma);

      col = mix(col, uFlashColor, uFlash);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export function createPostFx(renderer, scene, camera, theme, quality) {
  const size = renderer.getSize(new THREE.Vector2());
  const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: quality.id === 'low' ? 0 : 4,
  });

  const composer = new EffectComposer(renderer, renderTarget);
  composer.setPixelRatio(renderer.getPixelRatio());

  const grade = theme.grade;
  const renderPass = new RenderPass(scene, camera);
  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.uLift.value.fromArray(grade.lift);
  gradePass.uniforms.uGain.value.fromArray(grade.gain);
  gradePass.uniforms.uSaturation.value = grade.saturation;
  gradePass.uniforms.uContrast.value = grade.contrast;
  gradePass.uniforms.uVignette.value = grade.vignette;
  gradePass.uniforms.uGrain.value = grade.grain;

  // The creative grade operates in the render target's linear workflow;
  // OutputPass is deliberately last so tone mapping and color conversion
  // happen exactly once after grading.
  const outputPass = new OutputPass();
  for (const pass of orderedPostFxPasses(renderPass, gradePass, outputPass)) {
    composer.addPass(pass);
  }

  let time = 0;
  let flash = 0;
  const flashColor = gradePass.uniforms.uFlashColor.value;

  return {
    composer,

    render(dt) {
      time += dt;
      gradePass.uniforms.uTime.value = time;
      flash = Math.max(0, flash - dt * 3.2);
      gradePass.uniforms.uFlash.value = flash * flash * 0.55;
      composer.render(dt);
    },

    pulse(color, strength = 1) {
      flashColor.set(color);
      flash = Math.max(flash, strength);
    },

    setCamera(nextCamera) {
      for (const pass of composer.passes) {
        if (pass.camera) pass.camera = nextCamera;
      }
    },

    setSize(width, height) {
      composer.setSize(width, height);
      composer.setPixelRatio(renderer.getPixelRatio());
    },

    dispose() {
      composer.dispose();
      renderTarget.dispose();
    },
  };
}
