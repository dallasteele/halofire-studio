using UnityEngine;

public class GameBootstrap : MonoBehaviour
{
    void Start()
    {
        Physics.gravity = new Vector3(0, -9.81f, 0);
        Time.fixedDeltaTime = 1f / 60f;

        EnsureCamera();
        EnsureLight();
        BuildBackdrop();

        var court = CourtBuilder.Build(transform);
        var hoopHome = HoopBuilder.Build(transform, new Vector3(0, 0, -CourtBuilder.Length / 2 + 1.2f), 0f, 0);
        var hoopAway = HoopBuilder.Build(transform, new Vector3(0, 0, CourtBuilder.Length / 2 - 1.2f), 180f, 1);

        var ball = BallController.Spawn(new Vector3(0, 1.5f, 0));
        var home = Team.Spawn("Home", new Color(0.85f, 0.15f, 0.15f), +1, transform);
        var away = Team.Spawn("Away", new Color(0.15f, 0.3f, 0.85f), -1, transform);

        var gmGo = new GameObject("GameManager");
        var gm = gmGo.AddComponent<GameManager>();
        gm.Init(home, away, ball, hoopHome, hoopAway);

        var hudGo = new GameObject("HUD");
        hudGo.AddComponent<HUD>().Init(gm);

        new GameObject("ProcAudio").AddComponent<ProcAudio>();
    }

    void EnsureCamera()
    {
        var cam = Camera.main;
        if (cam == null)
        {
            var go = new GameObject("MainCamera");
            go.tag = "MainCamera";
            cam = go.AddComponent<Camera>();
            go.AddComponent<AudioListener>();
        }
        if (cam.GetComponent<FollowCamera>() == null) cam.gameObject.AddComponent<FollowCamera>();
        cam.fieldOfView = 60;
        cam.farClipPlane = 200;
        cam.backgroundColor = new Color(0.06f, 0.07f, 0.09f);
        cam.clearFlags = CameraClearFlags.SolidColor;
    }

    void EnsureLight()
    {
        var existing = FindObjectOfType<Light>();
        if (existing != null) return;
        var sun = new GameObject("Sun");
        var l = sun.AddComponent<Light>();
        l.type = LightType.Directional;
        l.intensity = 1.1f;
        l.color = new Color(1f, 0.98f, 0.9f);
        sun.transform.rotation = Quaternion.Euler(55, 35, 0);
        RenderSettings.ambientLight = new Color(0.4f, 0.42f, 0.5f);
    }

    void BuildBackdrop()
    {
        var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
        floor.name = "Arena_Floor";
        floor.transform.SetParent(transform);
        floor.transform.localScale = new Vector3(20, 1, 20);
        floor.transform.localPosition = new Vector3(0, -0.3f, 0);
        floor.GetComponent<Renderer>().material = MatLib.Make(new Color(0.05f, 0.06f, 0.08f), 0.2f);
    }
}
