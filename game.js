// Copyright 2017 Ben North
//
// This file is part of "Zombie 3D Game".
//
// "Zombie 3D Game" is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//
// "Zombie 3D Game" is distributed in the hope that it will be useful, but WITHOUT ANY
// WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
// PARTICULAR PURPOSE.  See the GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License along with "Zombie
// 3D Game".  If not, see <http://www.gnu.org/licenses/>.

gGame = null;

jQuery(document).ready(function($)
{
    G_PI = Math.PI;
    G_TWO_PI = 2.0 * Math.PI;
    G_HALF_PI = 0.5 * Math.PI;

    function KeypressMap(canvas) {
        this.key_down_buffer = new ArrayBuffer(256);
        this.key_down_p = new Uint8Array(this.key_down_buffer);

        var i;
        for (i = 0; i < 256; ++i)
            this.key_down_p[i] = 0;

        var self = this;
        canvas.keydown(function(evt) { self.key_down_p[evt.which] = 1; });
        canvas.keyup(function(evt) { self.key_down_p[evt.which] = 0; });
    }

    function V2(x, y) { return new BABYLON.Vector2(x, y); }
    function V3(x, y, z) { return new BABYLON.Vector3(x, y, z); }
    function C3(x, y, z) { return new BABYLON.Color3(x, y, z); }

    function nudge_towards_xz(p, q, ds) {
        var p2 = V2(p.x, p.z);
        var q2 = V2(q.x, q.z);
        var pq = q2.subtract(p2);
        pq.normalize();
        pq.scaleInPlace(ds);
        var result2 = p2.add(pq);
        return V3(result2.x, p.y, result2.y);
    }

    function distance_xz(p, q) {
        return V2(p.x - q.x, p.z - q.z).length();
    }

    function clamp_plus_minus_pi(th) {
        th = th % G_TWO_PI;
        if (th >= G_PI) th -= G_TWO_PI;
        if (th < -G_PI) th += G_TWO_PI;
        return th;
    }

    function load_scene(engine, url) {
        return new Promise(function(resolve, reject) {
            BABYLON.SceneLoader.Load(
                "", url, engine,
                function(scene) { scene.executeWhenReady(function() { resolve(scene); }); },
                null,
                reject);
        });
    }

    function import_meshes(scene, filename, mesh_names) {
        return new Promise(function(resolve, reject) {
            BABYLON.SceneLoader.ImportMesh(mesh_names, "./", filename, scene, resolve, null, reject);
        });
    }

    function new_texture(url, scene, noMipmap, invertY, samplingMode) {
        return new Promise(function(resolve, reject) {
            var tex = new BABYLON.Texture(url, scene, noMipmap, invertY, samplingMode,
                                          function() { resolve(tex); },
                                          function() { reject(); });
        });
    }

    function new_textures(urls, scene, noMipmap, invertY, samplingMode) {
        return Promise.all(urls.map(function(url) {
            return new_texture(url, scene, noMipmap, invertY, samplingMode);
        }));
    }

    function get_arraybuffer(url) {
        return new Promise(function(resolve, reject) {
            var req = new XMLHttpRequest();
            req.open('GET', url + '?v=1', true);
            req.responseType = 'arraybuffer';
            req.onload = function() {
                if (this.status == 200 && this.response != null)
                    resolve(new Uint8Array(this.response));
                else
                    reject('problem getting ' + url);
            };
            req.send();
        });
    }

    function pluck(attr, xs) {
        return xs.map(function(x) { return x[attr]; });
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function Hero(cam, map_mask, event_handler) {
        this.camera = cam;
        this.map_mask = map_mask;
        this.event_handler = event_handler;
    }

    Hero.prototype.rot_accel = 0.02;
    Hero.prototype.lin_accel = 50.0 / 2048.0;
    Hero.prototype.home_posn = V3(1.41, 0.25, 0.58);
    Hero.prototype.home_rotn = 3.51;

    Hero.prototype.reset = function() {
        this.prev_rot_speed = 0.0;
        this.prev_lin_speed = 0.0;
        this.n_bullets = 3;

        // Start with three lives, but keep 'life start' logic in one place.
        this.n_lives = 4;
        this.lose_life(false);
    }

    Hero.prototype.go_home = function() {
        this.camera.position = this.home_posn;
        this.camera.rotation.y = this.home_rotn;
    }

    Hero.prototype.add_bullets = function(n_new_bullets) {
        this.n_bullets += n_new_bullets;
        $('#bullets').html(this.n_bullets);
        if (n_new_bullets > 0)
            this.event_handler.launch_message_if_new(
                'You got ' + n_new_bullets + ' more bullets')
    }

    Hero.prototype.move_step = function(keypress_map) {
        var rot_speed = ((keypress_map.key_down_p[37] ? -this.rot_accel : 0.0)
                         + (keypress_map.key_down_p[39] ? this.rot_accel : 0.0));
        if (rot_speed == 0.0)
            rot_speed = 0.85 * this.prev_rot_speed;
        this.prev_rot_speed = rot_speed;

        var th = this.camera.rotation.y,
            dx = Math.cos(th),
            dy = Math.sin(th);

        var lin_speed = ((keypress_map.key_down_p[38] ? this.lin_accel : 0.0)
                         - (keypress_map.key_down_p[40] ? this.lin_accel : 0.0));
        if (lin_speed == 0.0)
            lin_speed = 0.85 * this.prev_lin_speed;
        this.prev_lin_speed = lin_speed;

        var d_pos = V3(lin_speed * dy, 0.0, lin_speed * dx);
        maybe_new_pos = this.position().add(d_pos);
        if (this.map_mask.point_ok(maybe_new_pos.x, maybe_new_pos.z))
            this.camera.position = maybe_new_pos;

        this.camera.rotation.y = clamp_plus_minus_pi(this.camera.rotation.y + rot_speed);
    }

    Hero.prototype.position = function() { return this.camera.position; }

    // Translate 'y axis rotation angle' back into angle in the xz-plane.
    Hero.prototype.view_angle = function()
    { return clamp_plus_minus_pi(G_HALF_PI - this.camera.rotation.y); }

    Hero.prototype.lose_life = function(with_message) {
        this.n_lives -= 1;
        $('#lives').html(this.n_lives);

        if (this.n_lives > 0) {
            this.go_home();
            if (with_message)
                this.event_handler.launch_message_if_new('A zombie got you!');
        } else
            this.event_handler.on_all_lives_lost();
    }

    Hero.prototype.on_shoot = function() {
        if (this.n_bullets == 0) {
            this.event_handler.on_no_ammo_to_shoot();
            return false;
        }

        this.n_bullets -= 1;
        $('#bullets').html(this.n_bullets);

        if (this.n_bullets == 0)
            this.event_handler.on_hero_ammo_exhausted();

        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function Debug(game) {
        this.game = game;
    }

    Debug.prototype.show_coords = function() {
        var game = this.game;
        var pos = game.hero.position();
        var cam = game.scene.activeCamera;

        var player = $('<p/>');
        player.append(pos.x.toFixed(2) + ", " + pos.z.toFixed(2)
                      + " (" + game.hero.view_angle().toFixed(2) + ")"
                      + " : "
                      + game.hero.map_mask.map_coords(pos.x, pos.z));

        var table = $('<table/>');
        this.game.monster_descriptors.forEach(function(d, i) {
            var m = game.monsters[i];
            var row = $('<tr/>');
            row.append('<td>' + d.mesh_name + '</td>');
            row.append('<td style="text-align: right">' + m.distance_to_hero().toFixed(2) + '</td>');
            row.append('<td style="text-align: right">' + m.distance_hero_home().toFixed(2) + '</td>');
            row.append('<td style="text-align: right">' + m.angle_to_hero().toFixed(2) + '</td>');
            table.append(row);
        });

        $('#coords').empty().append(player, table);
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function MapMask(width, height, x0, y0, x1, y1, data) {
        // Coordinate map is such that (x0, y0) maps to the (0, h-1) index into
        // the data array, and (x1, y1) maps to the (w-1, 0) index.

        this.src_width = x1 - x0;
        this.src_x0 = x0;

        // Invert sense of y because the first elements in the data correspond
        // to the highest 'world y' values:
        this.src_height = y0 - y1;
        this.src_y0 = y1;

        this.width = width;
        this.stride = (width / 8) | 0;  // Coerce to integer
        this.height = height;
        this.data = data;

        if ((width * height) != data.byteLength * 8)
            console.log('wrong dimensions');
    }

    MapMask.prototype.map_coords = function(x, y) {
        u = this.width * (x - this.src_x0) / this.src_width;
        v = this.height * (y - this.src_y0) / this.src_height;
        return [u | 0, v | 0];  // Coerce to integer
    }

    MapMask.prototype.point_ok = function(x, y) {
        uv = this.map_coords(x, y);
        u = uv[0]; v = uv[1];
        u_offset = u >> 3;
        u_bit_index = u & 7;
        mask = 1 << u_bit_index;
        flat_index = v * this.stride + u_offset;
        masked_elt = (this.data[flat_index] & mask);
        return (masked_elt != 0);
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    // TODO: Easing functions for end of patrol / scan.

    var G_Monster_patrol_speed = 0.015;
    var G_Monster_patrol_radius = 1.0;
    var G_Monster_scan_speed = 0.03;
    var G_Monster_spot_threshold = 3.0 * G_Monster_scan_speed;
    var G_Monster_pursuit_target_tilt = 0.6;
    var G_Monster_pursuit_tilt_rate = 0.015;
    var G_Monster_pursuit_target_y = -0.15;
    var G_Monster_pursuit_y_rate = -0.0005;
    var G_Monster_perish_target_y = -1.0;
    var G_Monster_perish_y_rate = -0.005;
    var G_Monster_respawn_delay = 100;
    var G_Monster_territory_radius = 5.8;
    var G_Monster_capture_radius = 0.2;
    var G_Monster_shot_by_hero_radius = 3.0;
    var G_Monster_shot_by_hero_angle = 0.2; // cf field-of-view = 0.45

    function MonsterPatrol(zombie, th0, th1) {
        this.zombie = zombie;
        this.th = th0;
        this.th1 = th1;
        this.r = G_Monster_patrol_radius;
        this.sdth = Math.sign(th1 - th0);
        this.dth = this.sdth * G_Monster_patrol_speed;
        this.phi_offset = -this.sdth * Math.PI / 2.0;
        this.n_steps_remaining = ((th1 - th0) / this.dth) | 0;  // coerce to int
    }

    MonsterPatrol.prototype.step = function() {
        if (this.n_steps_remaining-- == 0)
            return new MonsterScan(this.zombie, this.th, -this.sdth, this.r, 1);

        this.th += this.dth;
        var zm = this.zombie.mesh;
        zm.position.x = this.zombie.home.x + this.r * Math.cos(this.th);
        zm.position.z = this.zombie.home.z + this.r * Math.sin(this.th);
        zm.rotation.y = -(this.th + this.phi_offset);
        this.zombie.upright_pose();

        return this;
    }

    function MonsterScan(zombie, th, dph_sign, r, n_further_scans_allowed) {
        this.zombie = zombie;
        this.th = th;
        this.dph_sign = dph_sign;
        this.r = r;
        this.ph = th + dph_sign * Math.PI / 2;
        this.dph = dph_sign * G_Monster_scan_speed;
        this.n_steps_remaining = (Math.PI / G_Monster_scan_speed) | 0;
        this.n_further_scans_allowed = n_further_scans_allowed;
    }

    MonsterScan.prototype.step = function() {
        if (this.n_steps_remaining-- == 0) {
            if (this.n_further_scans_allowed == 0 || Math.random() < 0.5) {
                var next_patrol_size = 1.2 + 1.2 * Math.random();
                return new MonsterPatrol(this.zombie,
                                         this.th,
                                         this.th + this.dph_sign * next_patrol_size);
            } else
                return new MonsterScan(this.zombie,
                                       this.th,
                                       -this.dph_sign,
                                       this.r,
                                       this.n_further_scans_allowed - 1);
        }

        this.ph += this.dph;
        var zm = this.zombie.mesh;
        zm.rotation.y = -this.ph;

        var ray_to_hero = this.zombie.angle_to_hero();
        var diff = clamp_plus_minus_pi(Math.PI + ray_to_hero - this.ph);
        if (Math.abs(diff) < G_Monster_spot_threshold
            && this.zombie.distance_hero_home() < G_Monster_territory_radius)
            return new MonsterPursuitOfHero(this.zombie);

        return this;
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function MonsterPursuitOfHero(zombie) {
        this.zombie = zombie;
    }

    MonsterPursuitOfHero.prototype.step = function() {
        var zm = this.zombie.mesh;
        zm.position = nudge_towards_xz(zm.position, this.zombie.hero.position(), 0.02);

        // On entering MonsterPursuitOfHero we are already facing hero
        // because that's how we spotted her in the first place.  So
        // always directly face hero.
        zm.rotation.y = Math.PI - this.zombie.angle_to_hero();

        if (zm.rotation.z < G_Monster_pursuit_target_tilt)
            zm.rotation.z += G_Monster_pursuit_tilt_rate;
        if (zm.position.y > G_Monster_pursuit_target_y)
            zm.position.y += G_Monster_pursuit_y_rate;

        if (this.zombie.distance_hero_home() > G_Monster_territory_radius)
            return new MonsterReturnToBase(this.zombie);
        else if (this.zombie.distance_to_hero() < G_Monster_capture_radius) {
            this.zombie.hero.lose_life(true);
            return new MonsterRespawn(this.zombie);
        } else
            return this;
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function MonsterReturnToBase(zombie) {
        this.zombie = zombie;
    }

    MonsterReturnToBase.prototype.step = function() {
        // TODO: Slow turn to face base first
        this.zombie.upright_pose();
        var zm = this.zombie.mesh;
        zm.rotation.y = Math.PI - this.zombie.angle_to_home();
        zm.position = nudge_towards_xz(zm.position, this.zombie.home, 0.02);

        if (this.zombie.distance_hero_home() < G_Monster_territory_radius)
            return new MonsterPursuitOfHero(this.zombie);
        else if (this.zombie.distance_to_home() < G_Monster_patrol_radius) {
            var th0 = this.zombie.angle_to_home() + Math.PI;
            var th1 = th0 + ((Math.random() > 0.5) ? 1 : -1) * 2.0;
            // TODO: Slow turn to face patrol direction
            return new MonsterPatrol(this.zombie, th0, th1);
        } else
            return this;
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function MonsterPerish(zombie) {
        this.zombie = zombie;
    }

    MonsterPerish.prototype.step = function() {
        this.zombie.splat_costume();

        var zm = this.zombie.mesh;
        if (zm.position.y > G_Monster_perish_target_y) {
            zm.position.y += G_Monster_perish_y_rate;
            return this;
        } else
            return new MonsterAwaitRespawnAllowed(this.zombie);
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function MonsterAwaitRespawnAllowed(zombie) {
        this.zombie = zombie;
        this.respawn_seqnum = this.zombie.event_handler.zombie_spawn_seqnum + 2;
    }

    MonsterAwaitRespawnAllowed.prototype.step = function() {
        if (this.zombie.event_handler.zombie_spawn_seqnum >= this.respawn_seqnum)
            return new MonsterRespawn(this.zombie);
        else
            return this;
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function MonsterRespawn(zombie) {
        this.zombie = zombie;
        this.respawn_delay = G_Monster_respawn_delay;
    }

    MonsterRespawn.prototype.step = function() {
        if (this.respawn_delay-- == 0) {
            this.zombie.unsplat_costume();
            this.zombie.shootable = true;
            return new MonsterPatrol(this.zombie, 0.0, 3.0);
        } else
            return this;
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    function Monster(home, mesh, hero, splat, event_handler) {
        this.home = home;
        this.mesh = mesh;
        this.hero = hero;
        this.event_handler = event_handler;
        this.unsplat = mesh.material.diffuseTexture;
        this.splat = splat;
    }

    Monster.prototype.reset = function() {
        this.shootable = true;
        this.switch_to_perish = false;
        this.macro_step = new MonsterPatrol(this, 0.0, 3.0);
    }

    Monster.prototype.step = function() {
        if (this.switch_to_perish) {
            this.macro_step = new MonsterPerish(this);
            this.switch_to_perish = false;
            this.shootable = false;
        }

        this.macro_step = this.macro_step.step();
    }

    Monster.prototype.splat_costume = function() {
        this.mesh.material.diffuseTexture = this.splat;
    }

    Monster.prototype.unsplat_costume = function() {
        this.mesh.material.diffuseTexture = this.unsplat;
    }

    Monster.prototype.upright_pose = function() {
        this.mesh.position.y = 0.0;
        this.mesh.rotation.z = 0.0;
    }

    Monster.prototype.angle_to_hero = function() {
        var hero_posn = this.hero.position();
        return Math.atan2(hero_posn.z - this.mesh.position.z,
                          hero_posn.x - this.mesh.position.x);
    }

    Monster.prototype.angle_to_home = function() {
        var home_posn = this.home;
        return Math.atan2(home_posn.z - this.mesh.position.z,
                          home_posn.x - this.mesh.position.x);
    }

    Monster.prototype.distance_to_hero = function() {
        return distance_xz(this.hero.position(), this.mesh.position);
    }

    Monster.prototype.distance_hero_home = function() {
        return distance_xz(this.hero.position(), this.home);
    }

    Monster.prototype.distance_to_home = function() {
        return distance_xz(this.mesh.position, this.home);
    }

    Monster.prototype.on_shot_at = function() {
        if ( ! this.shootable)
            return;

        var angle_diff = clamp_plus_minus_pi(G_PI + this.hero.view_angle() - this.angle_to_hero());

        // TODO: Check the house isn't in the way.
        if (this.distance_to_hero() < G_Monster_shot_by_hero_radius
            && Math.abs(angle_diff) < G_Monster_shot_by_hero_angle) {
            //
            this.switch_to_perish = true;
            this.event_handler.on_zombie_killed();
        }
    }


    ////////////////////////////////////////////////////////////////////////////////////////

    G_AmmoDump_plunder_radius = 1.5;

    function AmmoDump(descr, seqnum_fun) {
        this.descr = descr;
        this.seqnum_fun = seqnum_fun;
        this.last_used_seqnum = 0;
    }

    AmmoDump.prototype.plunder_if_allowed = function(posn) {
        var seqnum = this.seqnum_fun();
        if (seqnum > this.last_used_seqnum
            && distance_xz(posn, this.descr.home) < G_AmmoDump_plunder_radius) {
            this.last_used_seqnum = seqnum;
            return this.descr.n_bullets;
        }

        return 0;
    }


    ////////////////////////////////////////////////////////////////////////////////////////

    function AmmoDumpCollection(descrs, seqnum_fun) {
        this.dumps = descrs.map(function(d) { return new AmmoDump(d, seqnum_fun); });
    }

    AmmoDumpCollection.prototype.plunder_if_allowed = function(posn) {
        return (this.dumps
                .map(function(d) { return d.plunder_if_allowed(posn); })
                .reduce(function(x, y) { return x + y; }, 0));
    }

    ////////////////////////////////////////////////////////////////////////////////////////

    G_Message_display_time = 200;

    function Game(canvas) {
        this.canvas = canvas;
        this.engine = new BABYLON.Engine(canvas[0], true);
        canvas.attr('tabindex', 0);
        canvas.focus();
        this.keypress_map = new KeypressMap(canvas);
    }

    Game.prototype.setup_scene = function(scene) {
        this.scene = scene;

        var cam = new BABYLON.FreeCamera("FreeCamera", Hero.prototype.home_posn, scene);
        cam.fov = 0.45;
        cam.minZ = 0.05;
        cam.rotation.y = Hero.prototype.home_rotn;
        scene.activeCamera = cam;

        var light0 = new BABYLON.HemisphericLight("Hemi0", V3(0, 1, 0), scene);
        light0.diffuse = new BABYLON.Color3(1, 1, 1);
        light0.specular = new BABYLON.Color3(0, 0, 0);
        light0.groundColor = new BABYLON.Color3(1, 1, 1);
        light0.intensity = 0.3;

        var light1 = new BABYLON.DirectionalLight("Dir0", V3(0.8, -1, -0.8), scene);
        light1.diffuse = new BABYLON.Color3(1, 1, 1);
        light1.specular = new BABYLON.Color3(0, 0, 0);
        light1.intensity = 0.3;

        // Skybox.  Source for images:
        // $ mv topaw2.jpg skybox_py.jpg
        // $ mv backaw2.jpg skybox_px.jpg
        // $ mv frontaw2.jpg  skybox_nx.jpg
        // $ mv leftaw2.jpg  skybox_nz.jpg
        // $ mv rightaw2.jpg  skybox_pz.jpg
        // $ cp skybox_py.jpg  skybox_ny.jpg
        //
        // (This re-uses the sky for the floor but we never see the floor so
        // it's OK.)
        var mat = new BABYLON.StandardMaterial("skyBox", scene);
        mat.backFaceCulling = false;
        mat.reflectionTexture = new BABYLON.CubeTexture("skybox1/skybox", scene);
        mat.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        var skybox = BABYLON.Mesh.CreateBox("skyBox", 1000.0, scene);
        skybox.material = mat;
    }

    Game.prototype.setup_assets = function(assets) {
        this.setup_scene(assets[0]);
        this.packed_map_mask = new MapMask(2048, 2048,
                                           -20.0, -20.0, 20.0, 20.0,
                                           assets[1]);

        this.hero = new Hero(this.scene.activeCamera, this.packed_map_mask, this);
    }

    Game.prototype.setup_monsters = function(meshes) {
        var self = this;
        this.monsters = meshes.map(function(mesh, i) {
            var descr = self.monster_descriptors[i];
            var sc = descr.scale;
            mesh.scaling = V3(sc, sc, sc);
            return new Monster(descr.home, mesh, self.hero, self.splat_textures[i], self);
        });
    }

    Game.prototype.step = function() {
        this.refresh_messages();

        if (this.state == 'await-start') {
            this.scene.render();

            if ( ! this.start_clicked)
                return;

            $('#start-button').hide();
            this.canvas.focus();
            this.state = 'playing';
            this.reset_game();
            return;
        }

        this.hero.move_step(this.keypress_map);
        this.dbg.show_coords();
        this.scene.render();

        var fire_pressed_now = this.keypress_map.key_down_p[32];
        if (!this.fire_pressed && fire_pressed_now) {
            if (this.hero.on_shoot()) {
                // Doesn't seem the best way to do it but still:
                var nzs = this.n_zombies_splatted;
                this.monsters.forEach(function(m) { m.on_shot_at(); });
                if (this.n_zombies_splatted == nzs)
                    this.launch_message_if_new('Missed!');
            }
        }
        this.fire_pressed = fire_pressed_now;

        this.monsters.forEach(function(m) { m.step(); });

        this.hero.add_bullets(this.ammo_dump_collection.plunder_if_allowed(this.hero.position()));
    }

    Game.prototype.on_zombie_killed = function() {
        this.ammo_seqnum += 1;
        this.zombie_spawn_seqnum += 1;
        this.n_zombies_splatted += 1;
        $('#score').html(this.n_zombies_splatted);
        this.launch_message_if_new('You splatted a zombie!')
    }

    Game.prototype.on_all_lives_lost = function() {
        this.launch_message_if_new('GAME OVER');
        $('#start-button').show();
        this.state = 'await-start';
    }

    Game.prototype.on_hero_ammo_exhausted = function() {
        this.ammo_seqnum += 1;
    }

    Game.prototype.on_no_ammo_to_shoot = function() {
        this.launch_message_if_new('No ammo!');
    }

    Game.prototype.launch_message_if_new = function(msg) {
        if ( ! this.player_messages.some(function(m) { return m[0] == msg; }))
            this.player_messages.push([msg, G_Message_display_time]);
    }

    Game.prototype.refresh_messages = function() {
        this.player_messages = (this.player_messages
                                .map(function(m) { return [m[0], m[1] - 1]; })
                                .filter(function(m) { return m[1] != 0; }));
        var div = $('<div/>');
        this.player_messages.forEach(function(m) {
            div.append('<p style="opacity:' + (m[1] / G_Message_display_time).toFixed(4) + '">' + m[0] + '</p>');
        });

        $('#msgs').empty().append(div);
    }

    Game.prototype.reset_game = function() {
        this.start_clicked = false;
        this.fire_pressed = false;

        var self = this;
        this.ammo_seqnum = 1;
        this.ammo_dump_collection = new AmmoDumpCollection(this.ammo_dump_descriptors,
                                                           function() { return self.ammo_seqnum; });

        this.zombie_spawn_seqnum = 1;

        this.n_zombies_splatted = 0;

        this.player_messages = [];

        this.hero.reset();
        this.monsters.forEach(function(m) { m.reset(); });
    }


    Game.prototype.run_game = function () {
        this.dbg = new Debug(this);

        var self = this;
        $('#start-button').attr('disabled', false);
        this.engine.runRenderLoop(function() { self.step(); });
    }

    Game.prototype.on_start_button = function() { this.start_clicked = true; }

    Game.prototype.run = function() {
        var fetch_scene = load_scene(this.engine, "world-003.babylon");
        var fetch_map = get_arraybuffer("map.bin");
        var fetch_assets = Promise.all([fetch_scene, fetch_map]);

        var splat_texture_names = this.monster_descriptors.map(function(m) {
            return m.mesh_name + '-w400-splatted.jpg'; });

        this.state = 'await-start';
        this.start_clicked = false;
        this.player_messages = [];

        var self = this;

        $('#start-button').click(function() { self.on_start_button(); });

        fetch_assets
            .then(function(assets) { self.setup_assets(assets); })
            .then(function() { return new_textures(splat_texture_names, self.scene); })
            .then(function(texs) { self.splat_textures = texs; })
            .then(function() { return import_meshes(self.scene, "monsters.babylon",
                                                    pluck('mesh_name', self.monster_descriptors)); })
            .then(function(meshes) { self.setup_monsters(meshes); })
            .then(function() { self.run_game(); });
    }

    Game.prototype.monster_descriptors = [
        // It seems that when you load multiple meshes, you get them
        // in the order that they are in the file, not in the order
        // you've asked for them.  Ensure the ordering here matches
        // the order in the .babylon file.  Sigh.
        {mesh_name: 'Green-zombie', scale: 0.1, home: V3(15.36, 0.0, 10.48)},
        {mesh_name: 'Brown-zombie', scale: 0.1, home: V3(-7.07, 0.0, 11.45)},
        {mesh_name: 'Red-zombie', scale: 0.1, home: V3(4.84, 0.0, 18.25)},
        {mesh_name: 'Blue-zombie', scale: 0.1, home: V3(-8.71, 0.0, -15.12)},
        {mesh_name: 'Yellow-zombie', scale: 0.1, home: V3(-13.39, 0.0, 1.42)},
    ];

    Game.prototype.ammo_dump_descriptors = [
        {tag: 'Tesco', home: V3(4.75, 0.0, -0.21), n_bullets: 3},
        {tag: 'Lidl', home: V3(7.69, 0.0, -11.22), n_bullets: 5},
    ];

    ////////////////////////////////////////////////////////////////////////////////////////

    if ( ! BABYLON.Engine.isSupported()) {
        // Erk!
        return;
    }

    gGame = (new Game($('#game-canvas')));
    gGame.run();
});
