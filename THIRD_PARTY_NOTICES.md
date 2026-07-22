# Third-party notices

## Three.js fluid-particle example

`src/projects/fluid-particles-webgpu.js` adapts the MLS-MPM compute sequence
from the Three.js `webgpu_compute_particles_fluid` example, release r185.

- Project: https://github.com/mrdoob/three.js
- Example: https://github.com/mrdoob/three.js/blob/r185/examples/webgpu_compute_particles_fluid.html
- License: MIT

Copyright © 2010-2026 Three.js authors.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## holtsetio/flow

`src/projects/fluid-particles-webgpu.js` was informed by the WebGPU fluid
architecture and separation between simulation and representation in
`holtsetio/flow`.

`src/engine/fluid/cauce-fluid-engine.js` and `src/projects/flow-cauce/` are a
direct, modified port of the Flow MLS-MPM solver, triangular noise, HSV field,
rounded particle renderer, lighting, room and post-processing pipeline to
Three.js r185 and the Cauce project contract. Its optional grid-based CSF
cohesion and surface-tension model is a Cauce extension and is not part of the
upstream Flow implementation. It also includes the assets credited below.

- Project: https://github.com/holtsetio/flow
- Source revision: `5bdbacc9d2659b9f5e98c405663d7da572d5cceb`
- License: MIT

Copyright (c) 2025 Holtsetio.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Autumn Field (Pure Sky)

The Flow reference scene and `08.4 · Flow Cauce` use the 1K HDRI published by
Poly Haven. Poly Haven distributes this asset under CC0 1.0 Universal.

- Asset: https://polyhaven.com/a/autumn_field_puresky
- Authors: Jarod Guest and Sergej Majboroda
- License: https://creativecommons.org/publicdomain/zero/1.0/

## TextureCan Concrete 0016

The Flow reference scene and `08.4 · Flow Cauce` use the 1K base-color,
normal, roughness and ambient-occlusion maps from TextureCan's Concrete 0016.
TextureCan distributes its PBR textures under CC0 1.0 Universal.

- Asset: https://www.texturecan.com/details/216/
- Terms: https://www.texturecan.com/terms/
- License: https://creativecommons.org/publicdomain/zero/1.0/
