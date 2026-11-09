import {
    _decorator, Button, Color, Component, EventTouch, game, instantiate, Label, Node, Prefab, Sprite, UITransform,
} from 'cc';

const { ccclass, property } = _decorator;

const TARGET_FRAME_RATE = 60;
const TRIPLE_SHOT_DURATION = 15;
const KILLS_PER_POWER_UP = 5;
const MISSES_ALLOWED_PER_WAVE = 5;
const POWER_UP_SPEED = 115;
const SIDE_SHOT_OFFSET = 13;
const FIRST_BOSS_TIME = 60;
const BOSS_WARNING_DURATION = 5;
const FIRST_WAVE_DURATION = FIRST_BOSS_TIME - BOSS_WARNING_DURATION;
const DIAGONAL_ENEMY_START_TIME = 15;
const DIAGONAL_ENEMY_INTERVAL = 4;
const DIAGONAL_ENEMY_DRIFT = 0.35;
const SECOND_WAVE_ENEMY_SPEED = 175;
const WAVE_TRANSITION_DURATION = 2;
const BOSS_HEALTH = 60;
const BOSS_ENTRY_DURATION = 1;
const BOSS_PATROL_Y = 164;
const BOSS_PATROL_WIDTH = 96;
const BOSS_ATTACK_INTERVAL = 2.8;
const BOSS_TELEGRAPH_DURATION = 0.7;
const BOSS_LANE_SPACING = 64;
const BOSS_SHOT_Y = 133;
const BOSS_SHOT_SPEED = 280;
const BOSS_DEFEAT_SCORE = 10;
const BOSS_DEFEAT_STAGE_MESSAGE = '旗舰已击破 · +10 分';
const SECOND_WAVE_STAGE_MESSAGE = '第 2 波 · 三发火力 15 秒';
const SHOOTER_ENEMY_INTERVAL = 8;
const SHOOTER_ENEMY_INDEX = 6;
const SHOOTER_FIRE_DEPTH = 60;
const SHOOTER_WARNING_DURATION = 0.6;
const SHOOTER_FLASHES_PER_SECOND = 8;
const ENEMY_SHOT_SPEED = 220;
const SHOOTER_MARK_COLOR = new Color(255, 232, 96, 255);
const SHOOTER_ALERT_COLOR = new Color(255, 80, 80, 255);
const MISS_COUNT_COLOR = new Color(165, 220, 242, 255);
const MISS_WARNING_COLOR = new Color(255, 198, 139, 255);

interface FlyingObject {
    node: Node;
    halfWidth: number;
    halfHeight: number;
    horizontalDrift: number;
    previousX: number;
    previousY: number;
}

interface ShooterState {
    kind: 'armed' | 'warning';
    timeToFire: number;
    sprite: Sprite;
}

interface EnemyObject extends FlyingObject {
    shooter: ShooterState | null;
    passHalfHeight: number;
    hasPassedPlayer: boolean;
}

interface BossPhase {
    kind: 'boss';
    ship: FlyingObject;
    health: number;
    elapsed: number;
    timeToAttack: number;
}

type BattlePhase = BossPhase
    | { kind: 'firstWave' | 'warning' | 'intermission'; remaining: number }
    | { kind: 'secondWave' };

@ccclass('PlaneBattle')
export class PlaneBattle extends Component {
    @property(Node) player: Node = null!;
    @property(Node) flightLayer: Node = null!;
    @property(Prefab) bulletPrefab: Prefab = null!;
    @property(Prefab) enemyPrefab: Prefab = null!;
    @property(Prefab) tripleShotPrefab: Prefab = null!;
    @property(Prefab) bossPrefab: Prefab = null!;
    @property(Prefab) bossShotPrefab: Prefab = null!;
    @property(Prefab) bossWarningPrefab: Prefab = null!;
    @property(Node) bossHud: Node = null!;
    @property(Sprite) bossHealthBar: Sprite = null!;
    @property(Label) stageLabel: Label = null!;
    @property(Label) boostLabel: Label = null!;
    @property(Label) scoreLabel: Label = null!;
    @property(Label) missLabel: Label = null!;
    @property(Node) resultPanel: Node = null!;
    @property(Label) resultTitle: Label = null!;
    @property(Label) resultScore: Label = null!;
    @property(Button) restartButton: Button = null!;

    @property shotInterval = 0.24;
    @property enemyInterval = 0.78;
    @property bulletSpeed = 540;
    @property enemySpeed = 140;

    private bullets: FlyingObject[] = [];
    private enemies: EnemyObject[] = [];
    private powerUps: FlyingObject[] = [];
    private bossShots: FlyingObject[] = [];
    private enemyShots: FlyingObject[] = [];
    private bossWarnings: FlyingObject[] = [];
    private phase: BattlePhase = { kind: 'firstWave', remaining: FIRST_WAVE_DURATION };
    private boostRemaining = 0;
    private score = 0;
    private killsSinceDrop = 0;
    private missedEnemies = 0;
    private missLimit = MISSES_ALLOWED_PER_WAVE;
    private playing = false;
    private timeToShot = 0;
    private timeToEnemy = 0;
    private enemiesSinceDive = 0;
    private secondWaveSpawns = 0;
    private dragId: number | null = null;
    private dragX = 0;
    private halfWidth = 0;
    private halfHeight = 0;
    private playerY = 0;
    private playerHalfWidth = 0;
    private playerHalfHeight = 0;
    private enemyHalfWidth = 0;
    private enemyHalfHeight = 0;
    private bulletHalfHeight = 0;

    onLoad(): void {
        const required = {
            player: this.player,
            flightLayer: this.flightLayer,
            bulletPrefab: this.bulletPrefab,
            enemyPrefab: this.enemyPrefab,
            tripleShotPrefab: this.tripleShotPrefab,
            bossPrefab: this.bossPrefab,
            bossShotPrefab: this.bossShotPrefab,
            bossWarningPrefab: this.bossWarningPrefab,
            bossHud: this.bossHud,
            bossHealthBar: this.bossHealthBar,
            stageLabel: this.stageLabel,
            boostLabel: this.boostLabel,
            scoreLabel: this.scoreLabel,
            missLabel: this.missLabel,
            resultPanel: this.resultPanel,
            resultTitle: this.resultTitle,
            resultScore: this.resultScore,
            restartButton: this.restartButton,
        };
        for (const name of Object.keys(required) as Array<keyof typeof required>) {
            if (!required[name]) {
                throw new Error('PlaneBattle is missing its scene reference: ' + name);
            }
        }

        if (!this.enemyPrefab.data.getComponent(Sprite)) {
            throw new Error('PlaneBattle requires a Sprite on the enemy prefab to mark shooting enemies');
        }

        const field = this.getSize(this.node);
        const player = this.getSize(this.player);
        const enemy = this.getSize(this.enemyPrefab.data);
        const bullet = this.getSize(this.bulletPrefab.data);
        this.halfWidth = field.width / 2;
        this.halfHeight = field.height / 2;
        this.playerY = this.player.position.y;
        this.playerHalfWidth = player.width / 2;
        this.playerHalfHeight = player.height / 2;
        this.enemyHalfWidth = enemy.width / 2;
        this.enemyHalfHeight = enemy.height / 2;
        this.bulletHalfHeight = bullet.height / 2;

        const tuning = {
            shotInterval: this.shotInterval,
            enemyInterval: this.enemyInterval,
            bulletSpeed: this.bulletSpeed,
            enemySpeed: this.enemySpeed,
        };
        for (const name of Object.keys(tuning) as Array<keyof typeof tuning>) {
            const value = tuning[name];
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error('PlaneBattle expects a positive finite value for ' + name);
            }
        }
    }

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.beginDrag, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.moveDrag, this);
        this.node.on(Node.EventType.TOUCH_END, this.endDrag, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.endDrag, this);
        this.restartButton.node.on(Button.EventType.CLICK, this.startRound, this);
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.beginDrag, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.moveDrag, this);
        this.node.off(Node.EventType.TOUCH_END, this.endDrag, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.endDrag, this);
        this.restartButton.node.off(Button.EventType.CLICK, this.startRound, this);
        this.dragId = null;
    }

    start(): void {
        game.frameRate = TARGET_FRAME_RATE;
        this.startRound();
    }

    update(dt: number): void {
        if (!this.playing) {
            return;
        }

        const phase = this.phase;
        const enemySpeed = phase.kind === 'secondWave' ? SECOND_WAVE_ENEMY_SPEED : this.enemySpeed;
        this.moveObjects(this.bullets, this.bulletSpeed * dt);
        this.moveObjects(this.enemies, -enemySpeed * dt);
        this.moveObjects(this.powerUps, -POWER_UP_SPEED * dt);
        this.moveObjects(this.bossShots, -BOSS_SHOT_SPEED * dt);
        this.moveObjects(this.enemyShots, -ENEMY_SHOT_SPEED * dt);
        if (phase.kind === 'boss') {
            this.moveBoss(phase, dt);
        }

        // Resolve player damage before awarding any points from this update.
        const player = this.player.position;
        const hitsPlayer = (object: FlyingObject) =>
            this.hits(object, player.x, player.y, player.y, this.playerHalfWidth, this.playerHalfHeight);
        if (this.enemies.some(hitsPlayer) || this.bossShots.some(hitsPlayer) || this.enemyShots.some(hitsPlayer)) {
            this.endRound('本局结束');
            return;
        }

        this.updatePowerUps(dt);
        this.updateBulletHits();
        this.updateMisses(player.y - this.playerHalfHeight);
        this.removeOffscreen(this.enemies);
        if (!this.playing) {
            return;
        }
        this.removeOffscreen(this.bossShots);
        this.removeOffscreen(this.enemyShots);
        this.updateEnemyFire(dt);
        this.updatePlayerFire(dt);

        // The victory frame belongs to the Boss fight, not the next wave's countdown.
        if (this.phase === phase) {
            this.updatePhase(phase, dt);
        }
    }

    private updatePowerUps(dt: number): void {
        const player = this.player.position;
        if (this.phase.kind !== 'intermission') {
            this.boostRemaining = Math.max(0, this.boostRemaining - dt);
        }
        for (let index = this.powerUps.length - 1; index >= 0; index--) {
            const powerUp = this.powerUps[index];
            if (this.hits(powerUp, player.x, player.y, player.y, this.playerHalfWidth, this.playerHalfHeight)) {
                this.boostRemaining = TRIPLE_SHOT_DURATION;
                this.removeObject(this.powerUps, index);
            } else if (powerUp.node.position.y + powerUp.halfHeight < -this.halfHeight) {
                this.removeObject(this.powerUps, index);
            }
        }
        this.updateBoostLabel();
    }

    private updateBulletHits(): void {
        for (let bulletIndex = this.bullets.length - 1; bulletIndex >= 0; bulletIndex--) {
            const bullet = this.bullets[bulletIndex];
            const position = bullet.node.position;
            const enemyIndex = this.enemies.findIndex(enemy => this.hits(
                enemy, position.x, bullet.previousY, position.y, bullet.halfWidth, bullet.halfHeight,
            ));
            if (enemyIndex !== -1) {
                const enemyPosition = this.enemies[enemyIndex].node.position;
                this.addScore(1);
                if (++this.killsSinceDrop % KILLS_PER_POWER_UP === 0) {
                    this.powerUps.push(this.spawn(this.tripleShotPrefab, enemyPosition.x, enemyPosition.y));
                }
                this.removeObject(this.enemies, enemyIndex);
                this.removeObject(this.bullets, bulletIndex);
            } else if (this.phase.kind === 'boss' && this.hits(
                this.phase.ship, position.x, bullet.previousY, position.y, bullet.halfWidth, bullet.halfHeight,
            )) {
                const boss = this.phase;
                this.removeObject(this.bullets, bulletIndex);
                this.bossHealthBar.fillRange = --boss.health / BOSS_HEALTH;
                if (boss.health === 0) {
                    this.defeatBoss(boss);
                }
            } else if (position.y - bullet.halfHeight > this.halfHeight) {
                this.removeObject(this.bullets, bulletIndex);
            }
        }
    }

    private updateMisses(playerBottom: number): void {
        const previousCount = this.missedEnemies;
        for (const enemy of this.enemies) {
            if (enemy.hasPassedPlayer || enemy.node.position.y + enemy.passHalfHeight >= playerBottom) {
                continue;
            }
            enemy.hasPassedPlayer = true;
            if (++this.missedEnemies > this.missLimit) {
                break;
            }
        }
        if (this.missedEnemies !== previousCount) {
            this.updateMissLabel();
            if (this.missedEnemies > this.missLimit) {
                this.endRound('漏防超限');
            }
        }
    }

    private resetMisses(wave: number): void {
        this.missedEnemies = 0;
        this.missLimit = wave * MISSES_ALLOWED_PER_WAVE;
        this.updateMissLabel();
    }

    private updateMissLabel(): void {
        const atLimit = this.missedEnemies === this.missLimit;
        this.missLabel.string = '漏防 ' + this.missedEnemies + '/' + this.missLimit + (atLimit ? ' · 再漏即败' : '');
        this.missLabel.color = this.missedEnemies >= this.missLimit ? MISS_WARNING_COLOR : MISS_COUNT_COLOR;
    }

    private removeOffscreen(objects: FlyingObject[]): void {
        for (let index = objects.length - 1; index >= 0; index--) {
            const object = objects[index];
            if (object.node.position.y + object.halfHeight < -this.halfHeight) {
                this.removeObject(objects, index);
            }
        }
    }

    private updatePlayerFire(dt: number): void {
        this.timeToShot -= dt;
        if (this.timeToShot <= 0) {
            this.timeToShot = this.shotInterval;
            const y = this.playerY + this.playerHalfHeight + this.bulletHalfHeight;
            const x = this.player.position.x;
            this.bullets.push(this.spawn(this.bulletPrefab, x, y));
            if (this.boostRemaining > 0) {
                this.bullets.push(this.spawn(this.bulletPrefab, x - SIDE_SHOT_OFFSET, y));
                this.bullets.push(this.spawn(this.bulletPrefab, x + SIDE_SHOT_OFFSET, y));
            }
        }
    }

    private updatePhase(phase: BattlePhase, dt: number): void {
        switch (phase.kind) {
        case 'firstWave':
            phase.remaining -= dt;
            if (phase.remaining <= 0) {
                this.phase = { kind: 'warning', remaining: BOSS_WARNING_DURATION + phase.remaining };
                this.showStage('敌方旗舰即将出现');
            } else {
                this.updateEnemySpawn(dt, phase.remaining <= FIRST_WAVE_DURATION - DIAGONAL_ENEMY_START_TIME, false);
            }
            break;
        case 'warning':
            phase.remaining -= dt;
            if (phase.remaining <= 0) {
                this.startBoss();
            }
            break;
        case 'boss':
            this.updateBossAttack(phase, dt);
            break;
        case 'intermission':
            phase.remaining -= dt;
            if (phase.remaining <= 0) {
                this.stageLabel.node.active = false;
                // The boss reward lands with the wave it was earned for, keeping the full duration playable.
                this.boostRemaining = TRIPLE_SHOT_DURATION;
                this.updateBoostLabel();
                this.timeToEnemy = this.enemyInterval;
                this.enemiesSinceDive = 0;
                this.secondWaveSpawns = 0;
                this.phase = { kind: 'secondWave' };
                this.resetMisses(2);
            } else {
                this.showStage(phase.remaining <= WAVE_TRANSITION_DURATION / 2
                    ? SECOND_WAVE_STAGE_MESSAGE : BOSS_DEFEAT_STAGE_MESSAGE);
            }
            break;
        case 'secondWave':
            this.updateEnemySpawn(dt, true, true);
            break;
        }
    }

    private updateEnemySpawn(dt: number, allowDiagonal: boolean, allowShooter: boolean): void {
        this.timeToEnemy -= dt;
        if (this.timeToEnemy > 0) {
            return;
        }

        this.timeToEnemy = this.enemyInterval;
        const y = this.halfHeight + this.enemyHalfHeight;
        const side = Math.random() * 2 - 1;
        // The 6th of every 8 second-wave enemies fires a shot; it never lands on a dive slot.
        const shooter = allowShooter && ++this.secondWaveSpawns % SHOOTER_ENEMY_INTERVAL === SHOOTER_ENEMY_INDEX;
        const dive = allowDiagonal ? ++this.enemiesSinceDive : 0;
        if (!shooter && dive === DIAGONAL_ENEMY_INTERVAL) {
            this.enemiesSinceDive = 0;
            const drift = side < 0 ? DIAGONAL_ENEMY_DRIFT : -DIAGONAL_ENEMY_DRIFT;
            // Mirrored dives start on one side and cross the middle of the playfield.
            this.enemies.push(this.spawnEnemy(-drift * y, y, drift));
        } else {
            const x = side * (this.halfWidth - this.enemyHalfWidth);
            const enemy = this.spawnEnemy(x, y);
            if (shooter) {
                this.markShooter(enemy);
            }
            this.enemies.push(enemy);
        }
    }

    private spawnEnemy(x: number, y: number, horizontalDrift = 0): EnemyObject {
        const enemy = this.spawn(this.enemyPrefab, x, y, horizontalDrift);
        const angle = Math.atan(horizontalDrift);
        enemy.node.angle = angle * 180 / Math.PI;
        return {
            ...enemy, shooter: null, hasPassedPlayer: false,
            passHalfHeight: Math.cos(angle) * enemy.halfHeight + Math.abs(Math.sin(angle)) * enemy.halfWidth,
        };
    }

    private markShooter(enemy: EnemyObject): void {
        const sprite = enemy.node.getComponent(Sprite)!;
        sprite.color = SHOOTER_MARK_COLOR;
        enemy.shooter = { kind: 'armed', timeToFire: 0, sprite };
    }

    private updateEnemyFire(dt: number): void {
        for (const enemy of this.enemies) {
            const shooter = enemy.shooter;
            if (!shooter) {
                continue;
            }
            if (shooter.kind === 'armed') {
                if (enemy.node.position.y <= this.halfHeight - SHOOTER_FIRE_DEPTH) {
                    shooter.kind = 'warning';
                    shooter.timeToFire = SHOOTER_WARNING_DURATION;
                }
                continue;
            }
            shooter.timeToFire -= dt;
            const elapsed = SHOOTER_WARNING_DURATION - shooter.timeToFire;
            shooter.sprite.color = Math.floor(elapsed * SHOOTER_FLASHES_PER_SECOND) % 2 === 0
                ? SHOOTER_ALERT_COLOR : SHOOTER_MARK_COLOR;
            if (shooter.timeToFire <= 0) {
                const position = enemy.node.position;
                this.enemyShots.push(this.spawn(this.bossShotPrefab, position.x, position.y));
                shooter.sprite.color = SHOOTER_MARK_COLOR;
                enemy.shooter = null;
            }
        }
    }

    private startBoss(): void {
        const size = this.getSize(this.bossPrefab.data);
        const ship = this.spawn(this.bossPrefab, 0, this.halfHeight + size.height / 2);
        this.phase = {
            kind: 'boss', ship, health: BOSS_HEALTH, elapsed: 0,
            timeToAttack: BOSS_ATTACK_INTERVAL - BOSS_TELEGRAPH_DURATION,
        };
        this.stageLabel.node.active = false;
        this.bossHealthBar.fillRange = 1;
        this.bossHud.active = true;
    }

    private moveBoss(boss: BossPhase, dt: number): void {
        boss.elapsed += dt;
        const ship = boss.ship;
        const entry = Math.min(1, boss.elapsed / BOSS_ENTRY_DURATION);
        const top = this.halfHeight + ship.halfHeight;
        const y = top + (BOSS_PATROL_Y - top) * entry;
        const patrolTime = Math.max(0, boss.elapsed - BOSS_ENTRY_DURATION);
        const x = Math.sin(patrolTime * 0.9) * BOSS_PATROL_WIDTH;
        this.moveObject(ship, x, y);
    }

    private updateBossAttack(boss: BossPhase, dt: number): void {
        boss.timeToAttack -= dt;
        if (boss.timeToAttack > 0) {
            return;
        }

        if (this.bossWarnings.length > 0) {
            for (const warning of this.bossWarnings) {
                this.bossShots.push(this.spawn(this.bossShotPrefab, warning.node.position.x, BOSS_SHOT_Y));
            }
            this.clearObjects(this.bossWarnings);
            boss.timeToAttack = BOSS_ATTACK_INTERVAL - BOSS_TELEGRAPH_DURATION;
            return;
        }

        const playerX = this.player.position.x;
        const triple = boss.health <= BOSS_HEALTH / 2;
        // At the edges, shift the entire spread so all three lanes stay playable.
        const centerLimit = this.halfWidth - this.playerHalfWidth - BOSS_LANE_SPACING;
        const center = Math.max(-centerLimit, Math.min(centerLimit, playerX));
        const lanes = triple ? [center - BOSS_LANE_SPACING, center, center + BOSS_LANE_SPACING] : [playerX];
        const warningHeight = BOSS_SHOT_Y + this.halfHeight;
        for (const x of lanes) {
            const warning = this.spawn(this.bossWarningPrefab, x, BOSS_SHOT_Y - warningHeight / 2);
            this.getSize(warning.node).height = warningHeight;
            this.bossWarnings.push(warning);
        }
        boss.timeToAttack = BOSS_TELEGRAPH_DURATION;
    }

    private defeatBoss(boss: BossPhase): void {
        this.destroyObject(boss.ship);
        this.clearObjects(this.bossShots);
        this.clearObjects(this.bossWarnings);
        this.bossHud.active = false;
        this.addScore(BOSS_DEFEAT_SCORE);
        this.phase = { kind: 'intermission', remaining: WAVE_TRANSITION_DURATION };
        this.showStage(BOSS_DEFEAT_STAGE_MESSAGE);
    }

    private showStage(message: string): void {
        if (this.stageLabel.string !== message) {
            this.stageLabel.string = message;
        }
        this.stageLabel.node.active = true;
    }

    private addScore(points: number): void {
        this.score += points;
        this.scoreLabel.string = String(this.score);
    }

    private endRound(title: string): void {
        this.playing = false;
        this.dragId = null;
        this.boostRemaining = 0;
        this.updateBoostLabel();
        this.clearObjects(this.bossWarnings);
        this.bossHud.active = false;
        this.stageLabel.node.active = false;
        this.resultTitle.string = title;
        this.resultScore.string = '本局得分  ' + this.score;
        this.resultPanel.active = true;
    }

    private startRound(): void {
        for (const objects of [this.bullets, this.enemies, this.powerUps, this.bossShots, this.enemyShots, this.bossWarnings]) {
            this.clearObjects(objects);
        }
        if (this.phase.kind === 'boss') {
            this.destroyObject(this.phase.ship);
        }
        this.phase = { kind: 'firstWave', remaining: FIRST_WAVE_DURATION };
        this.bossHud.active = false;
        this.stageLabel.node.active = false;
        this.boostRemaining = 0;
        this.updateBoostLabel();
        this.player.setPosition(0, this.playerY);
        this.dragId = null;
        this.score = 0;
        this.killsSinceDrop = 0;
        this.scoreLabel.string = '0';
        this.resetMisses(1);
        this.resultPanel.active = false;
        this.timeToShot = this.shotInterval;
        this.timeToEnemy = this.enemyInterval;
        this.enemiesSinceDive = 0;
        this.secondWaveSpawns = 0;
        this.playing = true;
    }

    private updateBoostLabel(): void {
        const text = this.boostRemaining > 0 ? '三发火力  ' + Math.ceil(this.boostRemaining) + 's' : '';
        if (this.boostLabel.string !== text) {
            this.boostLabel.string = text;
        }
        this.boostLabel.node.active = this.boostRemaining > 0;
    }

    private beginDrag(event: EventTouch): void {
        if (this.playing && this.dragId === null) {
            this.dragId = event.getID();
            this.dragX = event.getUILocation().x;
        }
    }

    private moveDrag(event: EventTouch): void {
        if (this.dragId === null || event.getID() !== this.dragId) {
            return;
        }
        const x = event.getUILocation().x;
        const limit = this.halfWidth - this.playerHalfWidth;
        const target = this.player.position.x + x - this.dragX;
        this.player.setPosition(Math.max(-limit, Math.min(limit, target)), this.playerY);
        this.dragX = x;
    }

    private endDrag(event: EventTouch): void {
        if (event.getID() === this.dragId) {
            this.dragId = null;
        }
    }

    private getSize(node: Node): UITransform {
        const transform = node.getComponent(UITransform);
        if (!transform || transform.width <= 0 || transform.height <= 0) {
            throw new Error('PlaneBattle requires a positive UI size on ' + node.name);
        }
        return transform;
    }

    private spawn(prefab: Prefab, x: number, y: number, horizontalDrift = 0): FlyingObject {
        const node = instantiate(prefab);
        const size = this.getSize(node);
        node.setPosition(x, y);
        this.flightLayer.addChild(node);
        return { node, previousX: x, previousY: y, horizontalDrift, halfWidth: size.width / 2, halfHeight: size.height / 2 };
    }

    private moveObjects(objects: FlyingObject[], dy: number): void {
        for (const object of objects) {
            const position = object.node.position;
            this.moveObject(object, position.x + Math.abs(dy) * object.horizontalDrift, position.y + dy);
        }
    }

    private moveObject(object: FlyingObject, x: number, y: number): void {
        const position = object.node.position;
        object.previousX = position.x;
        object.previousY = position.y;
        object.node.setPosition(x, y);
    }

    private hits(object: FlyingObject, x: number, startY: number, y: number, halfWidth: number, halfHeight: number): boolean {
        const position = object.node.position;
        const startGapY = startY - object.previousY;
        const endGapY = y - position.y;
        const reachY = halfHeight + object.halfHeight;
        if (Math.min(startGapY, endGapY) > reachY || Math.max(startGapY, endGapY) < -reachY) {
            return false;
        }

        const startGapX = x - object.previousX;
        const deltaX = object.previousX - position.x;
        const reachX = halfWidth + object.halfWidth;
        if (deltaX === 0) {
            return Math.abs(startGapX) <= reachX;
        }

        // Only test horizontal overlap during the part of the frame with vertical overlap.
        const deltaY = endGapY - startGapY;
        let enter = 0;
        let exit = 1;
        if (deltaY !== 0) {
            const firstEdge = (-reachY - startGapY) / deltaY;
            const secondEdge = (reachY - startGapY) / deltaY;
            enter = Math.max(0, Math.min(firstEdge, secondEdge));
            exit = Math.min(1, Math.max(firstEdge, secondEdge));
        }
        const entryGapX = startGapX + enter * deltaX;
        const exitGapX = startGapX + exit * deltaX;
        return Math.min(entryGapX, exitGapX) <= reachX && Math.max(entryGapX, exitGapX) >= -reachX;
    }

    private removeObject(objects: FlyingObject[], index: number): void {
        const [object] = objects.splice(index, 1);
        this.destroyObject(object);
    }

    private clearObjects(objects: FlyingObject[]): void {
        for (const object of objects) {
            this.destroyObject(object);
        }
        objects.length = 0;
    }

    private destroyObject(object: FlyingObject): void {
        object.node.removeFromParent();
        object.node.destroy();
    }
}
