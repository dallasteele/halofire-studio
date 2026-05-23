using UnityEngine;

public class FollowCamera : MonoBehaviour
{
    public Vector3 offset = new(0, 6.5f, -9f);
    public float lerp = 6f;
    public float yaw = 0f;
    public float mouseSensitivity = 2.5f;

    void Start()
    {
        transform.position = new Vector3(0, 12, -18);
        transform.rotation = Quaternion.Euler(28, 0, 0);
    }

    void LateUpdate()
    {
        var target = HumanPlayer.Current;
        if (target == null) return;

        if (Input.GetMouseButton(2))
        {
            yaw += Input.GetAxis("Mouse X") * mouseSensitivity;
        }
        Quaternion rot = Quaternion.Euler(0, yaw, 0);
        Vector3 desired = target.transform.position + rot * offset;
        transform.position = Vector3.Lerp(transform.position, desired, lerp * Time.deltaTime);
        Vector3 look = target.transform.position + Vector3.up * 1.4f;
        transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(look - transform.position), lerp * Time.deltaTime);
    }
}
