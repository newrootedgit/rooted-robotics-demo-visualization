import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Rooted Robotics Demo - Conveyor Palletizing with UR7e Arms
// UR7e specs: reach 1000mm, 7kg payload, 6-axis

let scene, camera, renderer, controls;
let conveyor, boxes = [], robotArms = [], pallets = [];
let isPlaying = true;
let clock = new THREE.Clock();

// UR7e colors (Universal Robots blue/grey)
const UR_BLUE = 0x1a3f5c;
const UR_LIGHT_BLUE = 0x5ba0d0;
const UR_GREY = 0x4a4a4a;
const UR_JOINT = 0x2a2a2a;

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8e8e8);
    scene.fog = new THREE.Fog(0xe8e8e8, 20, 50);

    // Camera
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(12, 8, 12);

    // Renderer with better quality
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    document.getElementById('container').appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.update();

    // Lighting - industrial style
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
    mainLight.position.set(10, 20, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 1;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -15;
    mainLight.shadow.camera.right = 15;
    mainLight.shadow.camera.top = 15;
    mainLight.shadow.camera.bottom = -15;
    scene.add(mainLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    // Floor - industrial concrete look
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0x888888,
        roughness: 0.9,
        metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Add floor markings
    addFloorMarkings();

    // Create overhead structure with UR7e arms
    createOverheadStructure();
    
    // Create conveyor belt (20ft long = ~6m, 12in wide = ~0.3m)
    createConveyor();
    
    // Create pallets on lazy susans
    createPallets();
    
    // Create initial boxes
    for (let i = 0; i < 6; i++) {
        createBox(-2.5 + i * 1.0);
    }

    // UI
    document.getElementById('loading').style.display = 'none';
    document.getElementById('controls').style.display = 'block';
    
    document.getElementById('playBtn').onclick = () => isPlaying = true;
    document.getElementById('pauseBtn').onclick = () => isPlaying = false;
    document.getElementById('resetBtn').onclick = resetScene;

    window.addEventListener('resize', onWindowResize);
    animate();
}

function addFloorMarkings() {
    // Safety zone lines (yellow)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const createLine = (x1, z1, x2, z2, width = 0.05) => {
        const length = Math.sqrt((x2-x1)**2 + (z2-z1)**2);
        const lineGeo = new THREE.PlaneGeometry(length, width);
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set((x1+x2)/2, 0.001, (z1+z2)/2);
        line.rotation.z = Math.atan2(z2-z1, x2-x1);
        scene.add(line);
    };
    
    // Robot work area boundary
    createLine(-4, 3.5, 3, 3.5);
    createLine(-4, -3.5, 3, -3.5);
    createLine(-4, -3.5, -4, 3.5);
    createLine(3, -3.5, 3, 3.5);
}

function createOverheadStructure() {
    // Industrial gantry/overhead structure
    const beamMat = new THREE.MeshStandardMaterial({ 
        color: 0x3a3a3a, 
        roughness: 0.6, 
        metalness: 0.8 
    });
    
    // Main vertical posts (4 corners)
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 16);
    const postPositions = [
        [-3.5, 2, 2.5], [2.5, 2, 2.5], [-3.5, 2, -2.5], [2.5, 2, -2.5]
    ];
    
    postPositions.forEach(pos => {
        const post = new THREE.Mesh(postGeo, beamMat);
        post.position.set(pos[0], pos[1], pos[2]);
        post.castShadow = true;
        scene.add(post);
    });
    
    // Horizontal beams connecting posts
    const hBeamGeo = new THREE.BoxGeometry(6, 0.12, 0.12);
    const hBeam1 = new THREE.Mesh(hBeamGeo, beamMat);
    hBeam1.position.set(-0.5, 4, 2.5);
    scene.add(hBeam1);
    const hBeam2 = new THREE.Mesh(hBeamGeo, beamMat);
    hBeam2.position.set(-0.5, 4, -2.5);
    scene.add(hBeam2);
    
    // Cross beams for robot mounting
    const crossBeamGeo = new THREE.BoxGeometry(0.12, 0.12, 5);
    const crossBeamPositions = [-2, -0.5, 1, 2];
    crossBeamPositions.forEach(x => {
        const beam = new THREE.Mesh(crossBeamGeo, beamMat);
        beam.position.set(x, 4, 0);
        scene.add(beam);
    });
    
    // Create 4 UR7e robot arms mounted from above
    const armMountPositions = [
        { x: -1.5, z: 1, side: 1 },   // Front left
        { x: 1, z: 1, side: 1 },      // Front right
        { x: -1.5, z: -1, side: -1 }, // Back left
        { x: 1, z: -1, side: -1 }     // Back right
    ];
    
    armMountPositions.forEach((pos, idx) => {
        createUR7e(pos.x, pos.z, idx, pos.side);
    });
}

function createUR7e(x, z, idx, side) {
    // UR7e robot arm - mounted upside down from overhead cantilever
    const armGroup = new THREE.Group();
    
    // Cantilever mount bracket
    const bracketGeo = new THREE.BoxGeometry(0.2, 0.4, 0.2);
    const bracketMat = new THREE.MeshStandardMaterial({ color: UR_GREY, roughness: 0.5, metalness: 0.7 });
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.position.set(0, 3.8, 0);
    armGroup.add(bracket);
    
    // UR7e Base (mounted upside down)
    const baseGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.12, 24);
    const baseMat = new THREE.MeshStandardMaterial({ color: UR_BLUE, roughness: 0.3, metalness: 0.6 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, 3.54, 0);
    armGroup.add(base);
    
    // Shoulder - Joint 1 (rotation around vertical - pointing down)
    const shoulderJoint = new THREE.Group();
    shoulderJoint.position.set(0, 3.48, 0);
    
    const shoulderGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.1, 24);
    const jointMat = new THREE.MeshStandardMaterial({ color: UR_JOINT, roughness: 0.4, metalness: 0.8 });
    const shoulder = new THREE.Mesh(shoulderGeo, jointMat);
    shoulder.rotation.x = Math.PI / 2;
    shoulderJoint.add(shoulder);
    
    // Upper arm link
    const upperArmGeo = new THREE.CapsuleGeometry(0.045, 0.35, 8, 16);
    const linkMat = new THREE.MeshStandardMaterial({ color: UR_LIGHT_BLUE, roughness: 0.3, metalness: 0.5 });
    const upperArm = new THREE.Mesh(upperArmGeo, linkMat);
    upperArm.position.set(0, -0.22, 0);
    upperArm.castShadow = true;
    shoulderJoint.add(upperArm);
    
    // Elbow joint
    const elbowJoint = new THREE.Group();
    elbowJoint.position.set(0, -0.45, 0);
    
    const elbowGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.08, 24);
    const elbow = new THREE.Mesh(elbowGeo, jointMat);
    elbow.rotation.x = Math.PI / 2;
    elbowJoint.add(elbow);
    
    // Forearm link
    const forearmGeo = new THREE.CapsuleGeometry(0.04, 0.32, 8, 16);
    const forearm = new THREE.Mesh(forearmGeo, linkMat);
    forearm.position.set(0, -0.2, 0);
    forearm.castShadow = true;
    elbowJoint.add(forearm);
    
    // Wrist 1 joint
    const wrist1Joint = new THREE.Group();
    wrist1Joint.position.set(0, -0.42, 0);
    
    const wrist1Geo = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 24);
    const wrist1 = new THREE.Mesh(wrist1Geo, jointMat);
    wrist1.rotation.z = Math.PI / 2;
    wrist1Joint.add(wrist1);
    
    // Wrist 2 joint
    const wrist2Joint = new THREE.Group();
    wrist2Joint.position.set(0, -0.08, 0);
    
    const wrist2Geo = new THREE.CylinderGeometry(0.035, 0.035, 0.05, 24);
    const wrist2 = new THREE.Mesh(wrist2Geo, jointMat);
    wrist2Joint.add(wrist2);
    
    // Wrist 3 / Tool flange
    const wrist3Joint = new THREE.Group();
    wrist3Joint.position.set(0, -0.06, 0);
    
    const flangeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.03, 24);
    const flange = new THREE.Mesh(flangeGeo, jointMat);
    wrist3Joint.add(flange);
    
    // Gripper (vacuum or finger gripper)
    const gripperGroup = new THREE.Group();
    gripperGroup.position.set(0, -0.05, 0);
    
    // Gripper body
    const gripperBodyGeo = new THREE.BoxGeometry(0.08, 0.04, 0.06);
    const gripperMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    const gripperBody = new THREE.Mesh(gripperBodyGeo, gripperMat);
    gripperGroup.add(gripperBody);
    
    // Gripper fingers
    const fingerGeo = new THREE.BoxGeometry(0.015, 0.06, 0.02);
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.7 });
    const finger1 = new THREE.Mesh(fingerGeo, fingerMat);
    finger1.position.set(-0.025, -0.05, 0);
    gripperGroup.add(finger1);
    const finger2 = new THREE.Mesh(fingerGeo, fingerMat);
    finger2.position.set(0.025, -0.05, 0);
    gripperGroup.add(finger2);
    
    wrist3Joint.add(gripperGroup);
    wrist2Joint.add(wrist3Joint);
    wrist1Joint.add(wrist2Joint);
    elbowJoint.add(wrist1Joint);
    shoulderJoint.add(elbowJoint);
    armGroup.add(shoulderJoint);
    
    armGroup.position.set(x, 0, z);
    scene.add(armGroup);
    
    robotArms.push({
        group: armGroup,
        shoulderJoint,
        elbowJoint,
        wrist1Joint,
        wrist2Joint,
        wrist3Joint,
        gripperGroup,
        idx,
        side,
        baseX: x,
        baseZ: z
    });
}

function createConveyor() {
    const conveyorGroup = new THREE.Group();
    
    // Main frame - aluminum extrusion style
    const frameMat = new THREE.MeshStandardMaterial({ 
        color: 0x888888, 
        roughness: 0.4, 
        metalness: 0.8 
    });
    
    // Side rails
    const railGeo = new THREE.BoxGeometry(6.2, 0.08, 0.06);
    const rail1 = new THREE.Mesh(railGeo, frameMat);
    rail1.position.set(0, 0.96, 0.18);
    rail1.castShadow = true;
    conveyorGroup.add(rail1);
    
    const rail2 = new THREE.Mesh(railGeo, frameMat);
    rail2.position.set(0, 0.96, -0.18);
    rail2.castShadow = true;
    conveyorGroup.add(rail2);
    
    // Support legs (angled industrial style)
    const legGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.92, 12);
    const legPositions = [
        [-2.8, 0.46, 0.2], [-2.8, 0.46, -0.2],
        [-1, 0.46, 0.2], [-1, 0.46, -0.2],
        [0.8, 0.46, 0.2], [0.8, 0.46, -0.2],
        [2.8, 0.46, 0.2], [2.8, 0.46, -0.2]
    ];
    
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, frameMat);
        leg.position.set(pos[0], pos[1], pos[2]);
        leg.castShadow = true;
        conveyorGroup.add(leg);
        
        // Foot pad
        const footGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.02, 12);
        const foot = new THREE.Mesh(footGeo, frameMat);
        foot.position.set(pos[0], 0.01, pos[2]);
        conveyorGroup.add(foot);
    });
    
    // Belt surface - dark rubber look
    const beltGeo = new THREE.BoxGeometry(6, 0.015, 0.3);
    const beltMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a, 
        roughness: 0.9, 
        metalness: 0.1 
    });
    conveyor = new THREE.Mesh(beltGeo, beltMat);
    conveyor.position.set(0, 0.93, 0);
    conveyorGroup.add(conveyor);
    
    // Belt texture - subtle ridges
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.8 });
    for (let i = -2.9; i <= 2.9; i += 0.1) {
        const ridgeGeo = new THREE.BoxGeometry(0.01, 0.018, 0.28);
        const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
        ridge.position.set(i, 0.932, 0);
        conveyorGroup.add(ridge);
    }
    
    // End rollers
    const rollerGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 16);
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.7 });
    
    const roller1 = new THREE.Mesh(rollerGeo, rollerMat);
    roller1.rotation.x = Math.PI / 2;
    roller1.position.set(-3.05, 0.93, 0);
    conveyorGroup.add(roller1);
    
    const roller2 = new THREE.Mesh(rollerGeo, rollerMat);
    roller2.rotation.x = Math.PI / 2;
    roller2.position.set(3.05, 0.93, 0);
    conveyorGroup.add(roller2);
    
    scene.add(conveyorGroup);
}

function createPallets() {
    const palletPositions = [
        { x: -2, z: 2.2 },
        { x: 1.5, z: 2.2 },
        { x: -2, z: -2.2 },
        { x: 1.5, z: -2.2 }
    ];
    
    palletPositions.forEach((pos, idx) => {
        // Lazy susan base
        const susanBaseGeo = new THREE.CylinderGeometry(0.55, 0.58, 0.08, 32);
        const susanMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.7 });
        const susanBase = new THREE.Mesh(susanBaseGeo, susanMat);
        susanBase.position.set(pos.x, 0.04, pos.z);
        susanBase.castShadow = true;
        scene.add(susanBase);
        
        // Rotating platform
        const platformGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.04, 32);
        const platformMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 });
        const platform = new THREE.Mesh(platformGeo, platformMat);
        platform.position.set(pos.x, 0.1, pos.z);
        scene.add(platform);
        
        // Pallet group (rotates with platform)
        const palletGroup = new THREE.Group();
        
        // Realistic pallet - standard 48x40" (1.2m x 1m) scaled down
        const palletMat = new THREE.MeshStandardMaterial({ 
            color: 0x8B6914, 
            roughness: 0.85, 
            metalness: 0.05 
        });
        
        // Top deck boards
        for (let i = -0.35; i <= 0.35; i += 0.1) {
            const boardGeo = new THREE.BoxGeometry(0.8, 0.018, 0.09);
            const board = new THREE.Mesh(boardGeo, palletMat);
            board.position.set(0, 0.07, i);
            board.castShadow = true;
            palletGroup.add(board);
        }
        
        // Stringers (3 lengthwise supports)
        const stringerGeo = new THREE.BoxGeometry(0.8, 0.08, 0.04);
        [-0.3, 0, 0.3].forEach(z => {
            const stringer = new THREE.Mesh(stringerGeo, palletMat);
            stringer.position.set(0, 0.02, z);
            stringer.castShadow = true;
            palletGroup.add(stringer);
        });
        
        // Bottom deck boards
        const bottomBoardGeo = new THREE.BoxGeometry(0.09, 0.015, 0.8);
        [-0.35, 0, 0.35].forEach(x => {
            const board = new THREE.Mesh(bottomBoardGeo, palletMat);
            board.position.set(x, -0.02, 0);
            palletGroup.add(board);
        });
        
        palletGroup.position.set(pos.x, 0.14, pos.z);
        scene.add(palletGroup);
        
        // Add some stacked boxes on pallets
        const stackGroup = new THREE.Group();
        const boxColors = [0x8B4513, 0x654321, 0x996633];
        for (let layer = 0; layer < 2; layer++) {
            for (let bx = -0.25; bx <= 0.25; bx += 0.25) {
                for (let bz = -0.2; bz <= 0.2; bz += 0.2) {
                    const stackBoxGeo = new THREE.BoxGeometry(0.22, 0.12, 0.18);
                    const stackBoxMat = new THREE.MeshStandardMaterial({ 
                        color: boxColors[Math.floor(Math.random() * boxColors.length)],
                        roughness: 0.8
                    });
                    const stackBox = new THREE.Mesh(stackBoxGeo, stackBoxMat);
                    stackBox.position.set(bx, 0.15 + layer * 0.13, bz);
                    stackBox.castShadow = true;
                    stackGroup.add(stackBox);
                }
            }
        }
        stackGroup.position.set(pos.x, 0.14, pos.z);
        scene.add(stackGroup);
        
        pallets.push({ 
            platform, 
            palletGroup, 
            stackGroup,
            rotation: idx * Math.PI / 4 
        });
    });
}

function createBox(xPos) {
    // Cardboard box - more realistic
    const boxGeo = new THREE.BoxGeometry(0.18, 0.12, 0.14);
    const boxMat = new THREE.MeshStandardMaterial({ 
        color: 0xc19a6b,
        roughness: 0.85,
        metalness: 0.0
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(xPos, 1.0, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
    
    // Add tape stripe
    const tapeGeo = new THREE.BoxGeometry(0.185, 0.02, 0.02);
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.6 });
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(xPos, 1.06, 0);
    scene.add(tape);
    
    boxes.push({ box, tape });
}

function resetScene() {
    // Remove existing boxes
    boxes.forEach(b => {
        scene.remove(b.box);
        scene.remove(b.tape);
    });
    boxes = [];
    
    // Create new boxes
    for (let i = 0; i < 6; i++) {
        createBox(-2.5 + i * 1.0);
    }
    
    // Reset pallet rotations
    pallets.forEach((p, idx) => {
        p.rotation = idx * Math.PI / 4;
    });
}

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    
    if (isPlaying) {
        // Move boxes along conveyor
        boxes.forEach((b) => {
            b.box.position.x += 0.008;
            b.tape.position.x += 0.008;
            if (b.box.position.x > 3.5) {
                b.box.position.x = -3.5;
                b.tape.position.x = -3.5;
            }
        });
        
        // Animate UR7e robot arms - realistic reaching motion
        robotArms.forEach((arm, idx) => {
            const phase = time * 0.8 + idx * Math.PI / 2;
            
            // Shoulder rotation (base rotation around vertical)
            arm.shoulderJoint.rotation.y = Math.sin(phase) * 0.4;
            
            // Elbow bend
            arm.elbowJoint.rotation.x = Math.sin(phase * 0.7) * 0.3 + 0.2;
            
            // Wrist articulation
            arm.wrist1Joint.rotation.x = Math.sin(phase * 1.2) * 0.25;
            arm.wrist2Joint.rotation.z = Math.sin(phase * 0.9) * 0.2;
            arm.wrist3Joint.rotation.y = Math.sin(phase * 1.5) * 0.3;
            
            // Gripper keeps pointing down-ish toward conveyor
            const reachAngle = arm.side * (Math.sin(phase) * 0.3);
            arm.wrist1Joint.rotation.z = reachAngle;
        });
        
        // Rotate pallets/lazy susans slowly
        pallets.forEach((p) => {
            p.rotation += 0.003;
            p.platform.rotation.y = p.rotation;
            p.palletGroup.rotation.y = p.rotation;
            p.stackGroup.rotation.y = p.rotation;
        });
    }
    
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
