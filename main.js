import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Rooted Robotics Demo - Conveyor Palletizing with UR5e/UR7e Arms
// UR7e specs: 850mm reach, 7.5kg payload (same mechanical design as UR5e)

let scene, camera, renderer, controls;
let boxes = [], robotArms = [], pallets = [];
let isPlaying = true;
let clock = new THREE.Clock();

// UR colors (Universal Robots branding)
const UR_BLUE = 0x1a4f6c;
const UR_LIGHT_BLUE = 0x6ca0c0;
const UR_BLACK = 0x1a1a1a;

// UR5e/7e dimensions (meters) - from official kinematics
const UR = {
    d1: 0.1625,       // base to shoulder
    a2: 0.425,        // upper arm length
    a3: 0.3922,       // forearm length
    d4: 0.1333,       // wrist 1
    d5: 0.0997,       // wrist 2
    d6: 0.0996,       // wrist 3
    baseRadius: 0.075,
    reach: 0.85       // max reach
};

// Conveyor speed: ~20 boxes/min = 1 box every 3 sec
const CONVEYOR_SPEED = 0.0008;

const BOX_STATE = {
    ON_CONVEYOR: 'conveyor',
    BEING_PICKED: 'picked',
    ON_PALLET: 'pallet'
};

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd8d8d8);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(3.5, 2.5, 3.5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.getElementById('container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    controls.update();

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(5, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.camera.near = 1;
    mainLight.shadow.camera.far = 30;
    mainLight.shadow.camera.left = -8;
    mainLight.shadow.camera.right = 8;
    mainLight.shadow.camera.top = 8;
    mainLight.shadow.camera.bottom = -8;
    scene.add(mainLight);

    scene.add(new THREE.DirectionalLight(0xffffff, 0.3).translateX(-5).translateY(5));

    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    createConveyor();
    createRobotSystem();
    createPallets();
    
    // Initial boxes
    for (let i = 0; i < 5; i++) {
        spawnBox(-1.2 + i * 0.3);
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

function createConveyor() {
    const group = new THREE.Group();
    
    const length = 3;
    const width = 0.3;
    const height = 0.72;  // Belt surface height
    
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x505050, roughness: 0.5, metalness: 0.7 });
    
    // Side rails
    [-1, 1].forEach(side => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.03), frameMat);
        rail.position.set(0, height - 0.03, side * (width/2 + 0.02));
        rail.castShadow = true;
        group.add(rail);
    });
    
    // Legs every 0.5m
    for (let x = -length/2 + 0.25; x <= length/2 - 0.2; x += 0.5) {
        [-1, 1].forEach(side => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, height - 0.08, 12), frameMat);
            leg.position.set(x, (height - 0.08)/2, side * (width/2 + 0.02));
            leg.castShadow = true;
            group.add(leg);
            
            // Foot
            const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.01, 12), frameMat);
            foot.position.set(x, 0.005, side * (width/2 + 0.02));
            group.add(foot);
        });
        
        // Cross brace
        const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, width + 0.05, 8), frameMat);
        brace.rotation.x = Math.PI / 2;
        brace.position.set(x, 0.15, 0);
        group.add(brace);
    }
    
    // End rollers
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.7 });
    [-length/2, length/2].forEach(x => {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, width, 20), rollerMat);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(x, height - 0.03, 0);
        group.add(roller);
    });
    
    // Belt
    const belt = new THREE.Mesh(
        new THREE.BoxGeometry(length - 0.1, 0.01, width - 0.02),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 })
    );
    belt.position.set(0, height - 0.03, 0);
    group.add(belt);
    
    scene.add(group);
}

function createRobotSystem() {
    // Overhead gantry - position arms so they can reach conveyor AND pallets
    // Conveyor at 0.72m, pallets at ~0.15m
    // Arms mounted at 1.1m height with reach of 0.85m can reach both
    
    const gantryHeight = 1.15;
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 0.6, metalness: 0.7 });
    
    // Simple gantry structure
    const posts = [
        [-1.0, 0, 0.9], [0.8, 0, 0.9],
        [-1.0, 0, -0.9], [0.8, 0, -0.9]
    ];
    
    posts.forEach(p => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, gantryHeight, 0.06), beamMat);
        post.position.set(p[0], gantryHeight/2, p[2]);
        post.castShadow = true;
        scene.add(post);
    });
    
    // Top rails
    const railGeo = new THREE.BoxGeometry(1.9, 0.08, 0.06);
    [0.9, -0.9].forEach(z => {
        const rail = new THREE.Mesh(railGeo, beamMat);
        rail.position.set(-0.1, gantryHeight, z);
        scene.add(rail);
    });
    
    // Cross beams for arm mounting
    const crossGeo = new THREE.BoxGeometry(0.06, 0.08, 1.9);
    [-0.5, 0.4].forEach(x => {
        const cross = new THREE.Mesh(crossGeo, beamMat);
        cross.position.set(x, gantryHeight, 0);
        scene.add(cross);
    });
    
    // Create 4 robot arms - positioned to reach conveyor and their pallet
    const armConfigs = [
        { x: -0.5, z: 0.5, targetPallet: 0, pickSide: 1 },
        { x: 0.4, z: 0.5, targetPallet: 1, pickSide: 1 },
        { x: -0.5, z: -0.5, targetPallet: 2, pickSide: -1 },
        { x: 0.4, z: -0.5, targetPallet: 3, pickSide: -1 }
    ];
    
    armConfigs.forEach((cfg, idx) => createUR7eArm(cfg, idx, gantryHeight));
}

function createUR7eArm(config, idx, mountHeight) {
    const arm = new THREE.Group();
    
    // Materials
    const blueMat = new THREE.MeshStandardMaterial({ color: UR_BLUE, roughness: 0.3, metalness: 0.5 });
    const lightBlueMat = new THREE.MeshStandardMaterial({ color: UR_LIGHT_BLUE, roughness: 0.35, metalness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: UR_BLACK, roughness: 0.4, metalness: 0.7 });
    
    // Mount plate
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 20), blackMat);
    mount.position.y = -0.0125;
    arm.add(mount);
    
    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(UR.baseRadius, UR.baseRadius * 1.05, 0.06, 20), blueMat);
    base.position.y = -0.055;
    arm.add(base);
    
    // J1 - Shoulder pan
    const j1 = new THREE.Group();
    j1.position.y = -0.085;
    
    // Shoulder housing
    const shoulderHousing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, UR.d1, 20),
        lightBlueMat
    );
    shoulderHousing.position.y = -UR.d1 / 2;
    shoulderHousing.castShadow = true;
    j1.add(shoulderHousing);
    
    // J2 - Shoulder lift  
    const j2 = new THREE.Group();
    j2.position.y = -UR.d1;
    
    // Joint sphere
    j2.add(new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 16), blackMat));
    
    // Upper arm
    const upperArm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.042, UR.a2 - 0.09, 8, 16),
        lightBlueMat
    );
    upperArm.rotation.x = Math.PI / 2;
    upperArm.position.z = -UR.a2 / 2;
    upperArm.castShadow = true;
    j2.add(upperArm);
    
    // J3 - Elbow
    const j3 = new THREE.Group();
    j3.position.z = -UR.a2;
    
    j3.add(new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 16), blackMat));
    
    // Forearm
    const forearm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.035, UR.a3 - 0.07, 8, 16),
        lightBlueMat
    );
    forearm.rotation.x = Math.PI / 2;
    forearm.position.z = -UR.a3 / 2;
    forearm.castShadow = true;
    j3.add(forearm);
    
    // J4 - Wrist 1
    const j4 = new THREE.Group();
    j4.position.set(0, UR.d4, -UR.a3);
    
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, UR.d5 * 1.8, 16), lightBlueMat);
    w1.position.y = -UR.d5 * 0.9;
    j4.add(w1);
    
    // J5 - Wrist 2
    const j5 = new THREE.Group();
    j5.position.y = -UR.d5;
    
    const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.035, 16), blackMat);
    w2.rotation.x = Math.PI / 2;
    j5.add(w2);
    
    // J6 - Wrist 3 / Flange
    const j6 = new THREE.Group();
    j6.position.z = -UR.d6;
    
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.015, 16), blackMat);
    flange.rotation.x = Math.PI / 2;
    j6.add(flange);
    
    // Gripper
    const gripper = new THREE.Group();
    gripper.position.z = -0.03;
    
    const gripBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.02, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 })
    );
    gripBody.rotation.x = Math.PI / 2;
    gripper.add(gripBody);
    
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
    const finger1 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.015), fingerMat);
    finger1.position.set(-0.022, 0, -0.04);
    gripper.add(finger1);
    const finger2 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.015), fingerMat);
    finger2.position.set(0.022, 0, -0.04);
    gripper.add(finger2);
    
    // Assemble chain
    j6.add(gripper);
    j5.add(j6);
    j4.add(j5);
    j3.add(j4);
    j2.add(j3);
    j1.add(j2);
    arm.add(j1);
    
    arm.position.set(config.x, mountHeight, config.z);
    scene.add(arm);
    
    robotArms.push({
        group: arm,
        j1, j2, j3, j4, j5, j6,
        gripper, finger1, finger2,
        config, idx,
        state: 'idle',
        targetBox: null,
        heldBox: null,
        animTime: 0
    });
}

function createPallets() {
    // Pallets positioned within arm reach
    // Arms at x=-0.5 and x=0.4, z=±0.5
    // Pallets slightly outward from arms
    const positions = [
        { x: -0.5, z: 1.0 },   // Front left
        { x: 0.4, z: 1.0 },    // Front right  
        { x: -0.5, z: -1.0 },  // Back left
        { x: 0.4, z: -1.0 }    // Back right
    ];
    
    positions.forEach((pos, idx) => {
        // Lazy susan
        const susanBase = new THREE.Mesh(
            new THREE.CylinderGeometry(0.38, 0.4, 0.03, 24),
            new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.7 })
        );
        susanBase.position.set(pos.x, 0.015, pos.z);
        scene.add(susanBase);
        
        const platform = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.02, 24),
            new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 })
        );
        platform.position.set(pos.x, 0.04, pos.z);
        scene.add(platform);
        
        // Pallet
        const palletGroup = new THREE.Group();
        const palletMat = new THREE.MeshStandardMaterial({ color: 0x9B7B4A, roughness: 0.85 });
        
        // Top boards
        for (let i = -0.22; i <= 0.22; i += 0.073) {
            const board = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.065), palletMat);
            board.position.set(0, 0.04, i);
            board.castShadow = true;
            palletGroup.add(board);
        }
        
        // Stringers
        [-0.2, 0, 0.2].forEach(z => {
            const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.025), palletMat);
            stringer.position.set(0, 0.01, z);
            palletGroup.add(stringer);
        });
        
        palletGroup.position.set(pos.x, 0.05, pos.z);
        scene.add(palletGroup);
        
        // Stack container
        const stackGroup = new THREE.Group();
        stackGroup.position.set(pos.x, 0.05, pos.z);
        scene.add(stackGroup);
        
        pallets.push({
            platform, palletGroup, stackGroup,
            rotation: 0,
            needsRotation: false,
            boxCount: 0,
            pos,
            // Track which positions are filled in current layer
            layerPositions: [false, false, false, false]  // 2x2 grid
        });
    });
}

function spawnBox(xPos) {
    const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.08, 0.09),
        new THREE.MeshStandardMaterial({ color: 0xc4a060, roughness: 0.8 })
    );
    box.position.set(xPos, 0.72 + 0.04, 0);  // On conveyor
    box.castShadow = true;
    scene.add(box);
    
    // Tape
    const tape = new THREE.Mesh(
        new THREE.BoxGeometry(0.125, 0.01, 0.018),
        new THREE.MeshStandardMaterial({ color: 0x8B7355 })
    );
    tape.position.y = 0.04;
    box.add(tape);
    
    boxes.push({
        mesh: box,
        state: BOX_STATE.ON_CONVEYOR,
        assignedArm: null
    });
}

function resetScene() {
    boxes.forEach(b => scene.remove(b.mesh));
    boxes = [];
    
    pallets.forEach(p => {
        while (p.stackGroup.children.length) p.stackGroup.remove(p.stackGroup.children[0]);
        p.boxCount = 0;
        p.rotation = 0;
        p.layerPositions = [false, false, false, false];
    });
    
    robotArms.forEach(arm => {
        arm.state = 'idle';
        arm.targetBox = null;
        arm.heldBox = null;
        arm.animTime = 0;
    });
    
    for (let i = 0; i < 5; i++) spawnBox(-1.2 + i * 0.3);
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function setArmAngles(arm, angles) {
    arm.j1.rotation.y = angles[0];
    arm.j2.rotation.x = angles[1];
    arm.j3.rotation.x = angles[2];
    arm.j4.rotation.y = angles[3];
    arm.j5.rotation.x = angles[4];
    arm.j6.rotation.y = angles[5];
}

function lerpAngles(a, b, t) {
    return a.map((v, i) => lerp(v, b[i], t));
}

function getGripperWorldPos(arm) {
    const pos = new THREE.Vector3();
    arm.gripper.getWorldPosition(pos);
    return pos;
}

function animate() {
    requestAnimationFrame(animate);
    
    const time = clock.getElapsedTime();
    
    if (isPlaying) {
        // Move boxes
        boxes.forEach(b => {
            if (b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm) {
                b.mesh.position.x += CONVEYOR_SPEED;
                if (b.mesh.position.x > 1.6) {
                    scene.remove(b.mesh);
                    b.state = 'removed';
                }
            }
        });
        
        // Clean and spawn
        boxes = boxes.filter(b => b.state !== 'removed');
        const conveyorBoxes = boxes.filter(b => b.state === BOX_STATE.ON_CONVEYOR && !b.assignedArm);
        if (conveyorBoxes.length < 4) {
            const minX = conveyorBoxes.length ? Math.min(...conveyorBoxes.map(b => b.mesh.position.x)) : 0;
            if (minX > -1.2) spawnBox(-1.5);
        }
        
        // Robot state machines
        robotArms.forEach((arm, armIdx) => {
            const cfg = arm.config;
            const side = cfg.pickSide;  // 1 = front, -1 = back
            
            // Joint angle poses (j1, j2, j3, j4, j5, j6)
            const home = [0, 0.3, -0.15, 0, 0.4, 0];
            const reachConveyor = [side * -0.9, 1.0, -0.6, 0, 0.35, 0];
            const aboveConveyor = [side * -0.9, 0.7, -0.4, 0, 0.35, 0];
            const reachPallet = [side * 1.0, 0.9, -0.5, 0, 0.3, 0];
            const abovePallet = [side * 1.0, 0.6, -0.35, 0, 0.3, 0];
            
            switch (arm.state) {
                case 'idle': {
                    // Look for box in reach zone
                    const box = boxes.find(b =>
                        b.state === BOX_STATE.ON_CONVEYOR &&
                        !b.assignedArm &&
                        b.mesh.position.x > cfg.x - 0.25 &&
                        b.mesh.position.x < cfg.x + 0.25
                    );
                    
                    if (box) {
                        box.assignedArm = armIdx;
                        arm.targetBox = box;
                        arm.state = 'movingToConveyor';
                        arm.animTime = 0;
                    }
                    
                    // Idle pose
                    const sway = Math.sin(time * 0.4 + armIdx) * 0.015;
                    setArmAngles(arm, [sway, home[1], home[2], 0, home[4], 0]);
                    break;
                }
                
                case 'movingToConveyor': {
                    arm.animTime += 0.015;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(home, aboveConveyor, t));
                    
                    // Open gripper
                    arm.finger1.position.x = lerp(-0.022, -0.035, t);
                    arm.finger2.position.x = lerp(0.022, 0.035, t);
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'reachingConveyor';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'reachingConveyor': {
                    arm.animTime += 0.018;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(aboveConveyor, reachConveyor, t));
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'grabbing';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'grabbing': {
                    arm.animTime += 0.04;
                    const t = Math.min(arm.animTime, 1);
                    
                    arm.finger1.position.x = lerp(-0.035, -0.022, t);
                    arm.finger2.position.x = lerp(0.035, 0.022, t);
                    
                    if (arm.animTime >= 1 && arm.targetBox) {
                        arm.targetBox.state = BOX_STATE.BEING_PICKED;
                        arm.heldBox = arm.targetBox;
                        arm.state = 'liftingFromConveyor';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'liftingFromConveyor': {
                    arm.animTime += 0.015;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(reachConveyor, aboveConveyor, t));
                    
                    if (arm.heldBox) {
                        const gp = getGripperWorldPos(arm);
                        arm.heldBox.mesh.position.set(gp.x, gp.y - 0.06, gp.z);
                    }
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'movingToPallet';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'movingToPallet': {
                    arm.animTime += 0.012;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(aboveConveyor, abovePallet, t));
                    
                    if (arm.heldBox) {
                        const gp = getGripperWorldPos(arm);
                        arm.heldBox.mesh.position.set(gp.x, gp.y - 0.06, gp.z);
                    }
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'loweringToPallet';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'loweringToPallet': {
                    arm.animTime += 0.015;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(abovePallet, reachPallet, t));
                    
                    if (arm.heldBox) {
                        const gp = getGripperWorldPos(arm);
                        arm.heldBox.mesh.position.set(gp.x, gp.y - 0.06, gp.z);
                    }
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'releasing';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'releasing': {
                    arm.animTime += 0.04;
                    const t = Math.min(arm.animTime, 1);
                    
                    arm.finger1.position.x = lerp(-0.022, -0.035, t);
                    arm.finger2.position.x = lerp(0.022, 0.035, t);
                    
                    if (arm.animTime >= 1 && arm.heldBox) {
                        const pallet = pallets[cfg.targetPallet];
                        scene.remove(arm.heldBox.mesh);
                        
                        // Calculate position in 2x2 layer
                        const layer = Math.floor(pallet.boxCount / 4);
                        const posInLayer = pallet.boxCount % 4;
                        const row = Math.floor(posInLayer / 2);
                        const col = posInLayer % 2;
                        
                        const stackedBox = arm.heldBox.mesh.clone();
                        stackedBox.position.set(
                            -0.08 + col * 0.16,
                            0.1 + layer * 0.09,
                            -0.06 + row * 0.12
                        );
                        pallet.stackGroup.add(stackedBox);
                        pallet.boxCount++;
                        pallet.layerPositions[posInLayer] = true;
                        
                        // Check if we need to rotate for next position
                        // Rotate when we've filled positions the arm can reach
                        // and need to fill positions on the far side
                        const nextPos = pallet.boxCount % 4;
                        if (nextPos === 2) {
                            // Filled near side (0,1), rotate to access far side (2,3)
                            pallet.needsRotation = true;
                            pallet.targetRotation = pallet.rotation + Math.PI;
                        }
                        
                        arm.heldBox.state = BOX_STATE.ON_PALLET;
                        arm.heldBox = null;
                        arm.targetBox = null;
                        arm.state = 'liftingFromPallet';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'liftingFromPallet': {
                    arm.animTime += 0.015;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(reachPallet, abovePallet, t));
                    
                    arm.finger1.position.x = lerp(-0.035, -0.022, t);
                    arm.finger2.position.x = lerp(0.035, 0.022, t);
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'returning';
                        arm.animTime = 0;
                    }
                    break;
                }
                
                case 'returning': {
                    arm.animTime += 0.012;
                    const t = smoothstep(Math.min(arm.animTime, 1));
                    setArmAngles(arm, lerpAngles(abovePallet, home, t));
                    
                    if (arm.animTime >= 1) {
                        arm.state = 'idle';
                        arm.animTime = 0;
                    }
                    break;
                }
            }
        });
        
        // Rotate pallets only when needed
        pallets.forEach(p => {
            if (p.needsRotation) {
                const diff = p.targetRotation - p.rotation;
                if (Math.abs(diff) > 0.01) {
                    p.rotation += diff * 0.03;
                    p.platform.rotation.y = p.rotation;
                    p.palletGroup.rotation.y = p.rotation;
                    p.stackGroup.rotation.y = p.rotation;
                } else {
                    p.rotation = p.targetRotation;
                    p.needsRotation = false;
                }
            }
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
